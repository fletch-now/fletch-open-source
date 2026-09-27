"use server";

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/dal";
import { db } from "@/lib/db";
import { appSettings, auditLog, creditEvents, dexTokens, user, watcherDeliveries, watchers } from "@/lib/db/schema";
import { providerSettingKey } from "@/lib/agent/provider-settings";
import { recordAudit } from "@/lib/audit";
import { DISCOVERY_FLOOR_KEY, PRICE_FLOOR_KEY, writeSetting } from "@/lib/admin/settings";
import { RH_MAINNET_ID } from "@/lib/config";
import { setWatcherEnabled } from "@/lib/watch/create";
import { syncRegistry } from "@/lib/registry/sync";
import { reapStaleBuilds, sweepWorkspaces } from "@/lib/build/reaper";
import { workspaceRoot } from "@/lib/build/workspace";
import { logEvent } from "@/lib/log";

// Every mutation an operator can make from /admin. Each one re-checks the admin
// session (a server action is a public endpoint), does one thing, and leaves an
// audit row naming the operator, so "who changed this" is never a guess.

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function setProviderIntegration(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = z.object({ provider: z.enum(["kimi", "openai", "anthropic"]), enabled: z.enum(["1", "0"]) })
    .safeParse({ provider: formData.get("provider"), enabled: formData.get("enabled") });
  if (!parsed.success) return { ok: false, message: "Choose a provider and its enabled state." };
  const key = providerSettingKey(parsed.data.provider);
  await db.transaction(async function update(tx) {
    // Serializes the previous-value read even before this setting has a row.
    await tx.execute(sql`select pg_advisory_xact_lock(4663, 9701)`);
    const [before] = await tx.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
    await tx.insert(appSettings).values({ key, value: parsed.data.enabled, updatedBy: admin.name })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed.data.enabled, updatedBy: admin.name, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ id: `al_${randomUUID()}`, userId: admin.userId, actorType: "user", action: "admin.model.integration",
      resourceType: "setting", resourceId: key, metadata: { previous: before?.value ?? "1", next: parsed.data.enabled } });
  });
  revalidatePath("/trafalgar/system");
  return { ok: true, message: parsed.data.enabled === "1" ? "Provider integration enabled." : "Provider integration paused. Further model requests are blocked." };
}

function fail(message: string): ActionResult {
  return { ok: false, message };
}

function done(message: string): ActionResult {
  return { ok: true, message };
}

const AdjustCredits = z.object({
  userId: z.string().min(1),
  delta: z.coerce.number().int().min(-100).max(100).refine((value) => value !== 0, "Zero changes nothing"),
  note: z.string().trim().max(200).optional(),
});

// The ledger stays append-only: an adjustment is a new row with its own reason,
// never an edit. Bounded to ±100 so a typo cannot mint a thousand builds.
export async function adjustCredits(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = AdjustCredits.safeParse({
    userId: formData.get("userId"),
    delta: formData.get("delta"),
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid adjustment");
  }
  const { userId, delta, note } = parsed.data;
  const id = randomUUID();
  await db.insert(creditEvents).values({
    id,
    userId,
    delta,
    reason: "admin_adjust",
    idempotencyKey: `admin_adjust:${id}`,
  });
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.credits.adjust",
    resourceType: "user",
    resourceId: userId,
    metadata: { delta, note: note ?? null },
  });
  revalidatePath(`/trafalgar/users/${userId}`);
  return done(`${delta > 0 ? "+" : ""}${delta} credits recorded.`);
}

const SetRole = z.object({
  userId: z.string().min(1),
  role: z.enum(["admin", "user"]),
});

export async function setUserRole(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = SetRole.safeParse({ userId: formData.get("userId"), role: formData.get("role") });
  if (!parsed.success) {
    return fail("Invalid role");
  }
  if (parsed.data.userId === admin.userId && parsed.data.role !== "admin") {
    return fail("You cannot remove your own admin role.");
  }
  await db.update(user).set({ role: parsed.data.role, updatedAt: new Date() }).where(eq(user.id, parsed.data.userId));
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.user.role",
    resourceType: "user",
    resourceId: parsed.data.userId,
    metadata: { role: parsed.data.role },
  });
  revalidatePath(`/trafalgar/users/${parsed.data.userId}`);
  return done(`Role set to ${parsed.data.role}.`);
}

const SetBanned = z.object({
  userId: z.string().min(1),
  banned: z.enum(["true", "false"]),
  reason: z.string().trim().max(200).optional(),
});

// A banned account keeps its rows: lib/dal's getSession treats a banned user as
// signed out, which closes every route behind it, and the account's watchers are
// paused here so the daemon stops spending RPC on them. Nothing is deleted.
export async function setUserBanned(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = SetBanned.safeParse({
    userId: formData.get("userId"),
    banned: formData.get("banned"),
    reason: formData.get("reason") ?? undefined,
  });
  if (!parsed.success) {
    return fail("Invalid request");
  }
  if (parsed.data.userId === admin.userId) {
    return fail("You cannot ban yourself.");
  }
  const banned = parsed.data.banned === "true";
  await db
    .update(user)
    .set({ banned, banReason: banned ? (parsed.data.reason ?? null) : null, updatedAt: new Date() })
    .where(eq(user.id, parsed.data.userId));
  if (banned) {
    await db.update(watchers).set({ enabled: false, status: "paused", updatedAt: new Date() }).where(eq(watchers.userId, parsed.data.userId));
  }
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: banned ? "admin.user.ban" : "admin.user.unban",
    resourceType: "user",
    resourceId: parsed.data.userId,
    metadata: { reason: parsed.data.reason ?? null },
  });
  revalidatePath(`/trafalgar/users/${parsed.data.userId}`);
  return done(banned ? "Account banned; its watchers are paused." : "Ban lifted.");
}

const SetWatcher = z.object({
  watcherId: z.string().min(1),
  enabled: z.enum(["true", "false"]),
});

export async function setWatcherEnabledAsAdmin(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = SetWatcher.safeParse({ watcherId: formData.get("watcherId"), enabled: formData.get("enabled") });
  if (!parsed.success) {
    return fail("Invalid request");
  }
  const rows = await db.select({ userId: watchers.userId }).from(watchers).where(eq(watchers.id, parsed.data.watcherId)).limit(1);
  const owner = rows[0];
  if (!owner) {
    return fail("Watcher not found");
  }
  const enabled = parsed.data.enabled === "true";
  await setWatcherEnabled(owner.userId, parsed.data.watcherId, enabled);
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: enabled ? "admin.watcher.enable" : "admin.watcher.disable",
    resourceType: "watcher",
    resourceId: parsed.data.watcherId,
    metadata: { ownerId: owner.userId },
  });
  revalidatePath("/trafalgar/watchers");
  return done(enabled ? "Watcher resumed." : "Watcher paused.");
}

const RetryDelivery = z.object({ deliveryId: z.string().min(1) });

// A failed delivery is usually "telegram not linked" at the time; once the person
// links, the row can go back on the queue instead of staying a permanent miss.
export async function retryDelivery(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = RetryDelivery.safeParse({ deliveryId: formData.get("deliveryId") });
  if (!parsed.success) {
    return fail("Invalid request");
  }
  const updated = await db
    .update(watcherDeliveries)
    .set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null })
    .where(eq(watcherDeliveries.id, parsed.data.deliveryId))
    .returning({ id: watcherDeliveries.id });
  if (!updated[0]) {
    return fail("Delivery not found");
  }
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.delivery.retry",
    resourceType: "delivery",
    resourceId: parsed.data.deliveryId,
  });
  revalidatePath("/trafalgar/deliveries");
  return done("Queued for another attempt.");
}

export async function syncRegistryNow(): Promise<ActionResult> {
  const admin = await requireAdmin();
  try {
    const result = await syncRegistry();
    await recordAudit({
      userId: admin.userId,
      actorType: "user",
      action: "admin.registry.sync",
      metadata: result,
    });
    revalidatePath("/trafalgar/registry");
    return done(`Synced: ${result.upserted} upserted, ${result.skipped} skipped.`);
  } catch (cause) {
    logEvent("registry", { event: "admin-sync-failed", error: String(cause) });
    return fail("Sync failed; see the server log.");
  }
}

export async function reapNow(): Promise<ActionResult> {
  const admin = await requireAdmin();
  const [reaped, sweep] = await Promise.all([reapStaleBuilds(), sweepWorkspaces(workspaceRoot())]);
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.system.reap",
    metadata: { reaped, workspacesRemoved: sweep.removed },
  });
  revalidatePath("/trafalgar/system");
  return done(`Reaped ${reaped} stuck build(s), removed ${sweep.removed} old workspace(s).`);
}

const SetDiscoveryFloor = z.object({ floor: z.coerce.number().min(0).max(1_000_000) });

// The dollars of depth a discovered token needs before default listings show
// it. Nothing is deleted at any setting: the token stays on record, resolvable
// by address and watchable.
export async function setDiscoveryFloor(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = SetDiscoveryFloor.safeParse({ floor: formData.get("floor") });
  if (!parsed.success) {
    return fail("Give a dollar figure between 0 and 1,000,000.");
  }
  await writeSetting(DISCOVERY_FLOOR_KEY, String(parsed.data.floor), admin.name);
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.discovery.floor",
    resourceType: "setting",
    resourceId: DISCOVERY_FLOOR_KEY,
    metadata: { floorUsd: parsed.data.floor },
  });
  revalidatePath("/trafalgar/tokens");
  return done(`Default listings now need $${parsed.data.floor} of depth.`);
}

const HideToken = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/), hidden: z.enum(["true", "false"]) });

// Hiding keeps the row and everything read from it; it takes the token out of
// default listings. A watcher already pointed at it keeps working.
export async function setTokenHidden(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = HideToken.safeParse({ address: formData.get("address"), hidden: formData.get("hidden") });
  if (!parsed.success) {
    return fail("Invalid request");
  }
  const hidden = parsed.data.hidden === "true";
  const address = parsed.data.address.toLowerCase();
  const updated = await db
    .update(dexTokens)
    .set({ hidden })
    .where(eq(dexTokens.id, `${RH_MAINNET_ID}:${address}`))
    .returning({ id: dexTokens.id });
  if (!updated[0]) {
    return fail("Token not found");
  }
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: hidden ? "admin.token.hide" : "admin.token.show",
    resourceType: "token",
    resourceId: address,
  });
  revalidatePath("/trafalgar/tokens");
  return done(hidden ? "Hidden from default listings." : "Shown in default listings again.");
}

const SetPriceFloor = z.object({ floor: z.coerce.number().min(0).max(1_000_000) });

// Dollars of quote-side depth a pool needs before its price, change windows,
// FDV and market cap are published. Below it they read as "—": a pool holding
// a few dollars can be made to print any price its deployer likes.
export async function setPriceFloor(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  const parsed = SetPriceFloor.safeParse({ floor: formData.get("floor") });
  if (!parsed.success) {
    return fail("Give a dollar figure between 0 and 1,000,000.");
  }
  await writeSetting(PRICE_FLOOR_KEY, String(parsed.data.floor), admin.name);
  await recordAudit({
    userId: admin.userId,
    actorType: "user",
    action: "admin.markets.price_floor",
    resourceType: "setting",
    resourceId: PRICE_FLOOR_KEY,
    metadata: { floorUsd: parsed.data.floor },
  });
  revalidatePath("/trafalgar/tokens");
  revalidatePath("/registry/markets");
  return done(`Prices now need $${parsed.data.floor} of quote-side depth.`);
}
