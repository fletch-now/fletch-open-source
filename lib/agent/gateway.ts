import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds, gatewayRequests, modelGateways, projects } from "@/lib/db/schema";
import { BuildSelectionError, isProviderId, TEXT_CAPABILITIES, validModel, type ProviderId } from "@/lib/agent/selection";
import { revokeCredentialLeases } from "@/lib/agent/lease-revocation";
import type { ProviderConfig } from "@/lib/agent/provider";

const PAIRING_MS = 10 * 60_000;
const REQUEST_MS = 180_000;
const BUILD_MS = 2 * 60 * 60_000;
const MAX_REQUESTS = 400;
function token(): string { return randomBytes(32).toString("base64url"); }
export function tokenHash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
export async function createGateway(userId: string, provider: ProviderId, model: string, label: string): Promise<{ id: string; pairingToken: string }> {
  if (!validModel(model)) throw new BuildSelectionError("Choose a valid model ID.");
  const id = `gw_${randomUUID()}`, pairingToken = token();
  await db.insert(modelGateways).values({ id, userId, provider, model, label, pairingHash: tokenHash(pairingToken), pairingExpiresAt: new Date(Date.now() + PAIRING_MS) });
  return { id, pairingToken };
}
export async function pairGateway(pairingToken: string): Promise<{ id: string; ownerId: string; provider: string; model: string; token: string } | null> {
  const auth = token();
  const [row] = await db.update(modelGateways).set({ tokenHash: tokenHash(auth), pairingHash: null, pairedAt: new Date(), lastSeenAt: new Date() })
    .where(and(eq(modelGateways.pairingHash, tokenHash(pairingToken)), gt(modelGateways.pairingExpiresAt, new Date()), isNull(modelGateways.revokedAt), isNull(modelGateways.pairedAt)))
    .returning({ id: modelGateways.id, ownerId: modelGateways.userId, provider: modelGateways.provider, model: modelGateways.model });
  return row ? { ...row, token: auth } : null;
}
export async function authenticatedGateway(auth: string): Promise<typeof modelGateways.$inferSelect | null> {
  if (auth.length < 32 || auth.length > 100) return null;
  const [row] = await db.select().from(modelGateways).where(and(eq(modelGateways.tokenHash, tokenHash(auth)), isNull(modelGateways.revokedAt), isNotNull(modelGateways.pairedAt)));
  return row ?? null;
}
export async function listGateways(userId: string): Promise<Array<{ id: string; version: number; provider: ProviderId; model: string; label: string; custodyMode: "gateway"; keyPrefix: string; validationStatus: string; validatedAt: Date | null; capabilities: typeof TEXT_CAPABILITIES; createdAt: Date; lastUsedAt: Date | null }>> {
  const rows = await db.select({ id: modelGateways.id, version: modelGateways.version, provider: modelGateways.provider, model: modelGateways.model,
    label: modelGateways.label, lastSeenAt: modelGateways.lastSeenAt, pairedAt: modelGateways.pairedAt, createdAt: modelGateways.createdAt }).from(modelGateways)
    .where(and(eq(modelGateways.userId, userId), isNull(modelGateways.revokedAt), isNotNull(modelGateways.pairedAt)));
  return rows.filter((row) => isProviderId(row.provider)).map(function metadata(row) {
    return { id: row.id, version: row.version, provider: row.provider as ProviderId, model: row.model, label: row.label,
      custodyMode: "gateway", keyPrefix: tokenHash(row.id).slice(0, 12), validationStatus: row.lastSeenAt && row.lastSeenAt.getTime() > Date.now() - 60_000 ? "connected" : "disconnected",
      validatedAt: row.pairedAt, capabilities: TEXT_CAPABILITIES, createdAt: row.createdAt, lastUsedAt: row.lastSeenAt };
  });
}
export async function revokeGateway(userId: string, id: string): Promise<void> {
  const revoked = await db.transaction(async function revoke(tx) {
    await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    const [owned] = await tx.update(modelGateways).set({ revokedAt: new Date(), tokenHash: null, pairingHash: null })
      .where(and(eq(modelGateways.id, id), eq(modelGateways.userId, userId))).returning({ id: modelGateways.id });
    if (owned) await tx.update(gatewayRequests).set({ status: "revoked", responseHash: null, payload: {}, result: null }).where(eq(gatewayRequests.gatewayId, id));
    return Boolean(owned);
  });
  if (revoked) revokeCredentialLeases(id);
}
export async function gatewayActive(id: string, userId: string, version: number): Promise<boolean> {
  const [row] = await db.select({ id: modelGateways.id }).from(modelGateways).where(and(eq(modelGateways.id, id), eq(modelGateways.userId, userId),
    eq(modelGateways.version, version), isNull(modelGateways.revokedAt), isNotNull(modelGateways.pairedAt)));
  return Boolean(row);
}
export interface RelayClaim { id: string; responseToken: string; buildId: string; projectId: string | null; projectName: string; provider: string; model: string; expiresAt: string; requestExpiresAt: string; maxRequests: number; maxOutputTokens: number; payload: Record<string, unknown> }
export async function claimGatewayRequest(gatewayId: string): Promise<RelayClaim | null> {
  return db.transaction(async function claim(tx) {
    const [gateway] = await tx.select().from(modelGateways).where(and(eq(modelGateways.id, gatewayId), isNull(modelGateways.revokedAt))).for("update");
    if (!gateway) return null;
    await tx.update(modelGateways).set({ lastSeenAt: new Date() }).where(eq(modelGateways.id, gatewayId));
    await tx.update(gatewayRequests).set({ status: "expired", payload: {}, result: null, responseHash: null }).where(and(eq(gatewayRequests.gatewayId, gatewayId), lt(gatewayRequests.expiresAt, new Date())));
    const [pending] = await tx.select().from(gatewayRequests).where(and(eq(gatewayRequests.gatewayId, gatewayId), eq(gatewayRequests.status, "pending"), gt(gatewayRequests.expiresAt, new Date()))).orderBy(gatewayRequests.createdAt).limit(1).for("update", { skipLocked: true });
    if (!pending) return null;
    const [build] = await tx.select({ id: builds.id, projectId: builds.projectId, createdAt: builds.createdAt, status: builds.status }).from(builds).where(eq(builds.id, pending.buildId));
    if (!build || build.status !== "building") { await tx.update(gatewayRequests).set({ status: "cancelled", payload: {} }).where(eq(gatewayRequests.id, pending.id)); return null; }
    const [project] = build.projectId ? await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, build.projectId)) : [];
    const responseToken = token();
    await tx.update(gatewayRequests).set({ status: "claimed", responseHash: tokenHash(responseToken) }).where(eq(gatewayRequests.id, pending.id));
    return { id: pending.id, responseToken, buildId: build.id, projectId: build.projectId, projectName: project?.name ?? "New app", provider: gateway.provider, model: gateway.model,
      expiresAt: new Date(build.createdAt.getTime() + BUILD_MS).toISOString(), requestExpiresAt: pending.expiresAt.toISOString(), maxRequests: MAX_REQUESTS, maxOutputTokens: 16384, payload: pending.payload };
  });
}
export async function completeGatewayRequest(gatewayId: string, id: string, responseToken: string, result: { status: number; body: Record<string, unknown> }): Promise<boolean> {
  const [updated] = await db.update(gatewayRequests).set({ status: "completed", result, payload: {}, responseHash: null }).where(and(
    eq(gatewayRequests.id, id), eq(gatewayRequests.gatewayId, gatewayId), eq(gatewayRequests.status, "claimed"),
    eq(gatewayRequests.responseHash, tokenHash(responseToken)), gt(gatewayRequests.expiresAt, new Date()),
    sql`exists (select 1 from model_gateways g where g.id = ${gatewayId} and g.revoked_at is null)`,
  )).returning({ id: gatewayRequests.id });
  return Boolean(updated);
}
export async function requestGateway(config: ProviderConfig, payload: Record<string, unknown>, signal: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!config.gatewayId || !config.ownerId || !config.buildId) throw new Error("The model gateway has no approved build binding.");
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 4 * 1024 * 1024) throw new Error("The model gateway request is too large.");
  const id = randomUUID();
  await db.transaction(async function queue(tx) {
    const [build] = await tx.select().from(builds).where(and(eq(builds.id, config.buildId!), eq(builds.userId, config.ownerId!))).for("update");
    if (!build || build.status !== "building" || build.custodyMode !== "gateway" || build.credentialId !== config.gatewayId || build.model !== config.model || build.provider !== config.id || build.createdAt.getTime() + BUILD_MS < Date.now()) throw new Error("The model gateway build is expired or no longer running.");
    if (!await gatewayActive(config.gatewayId!, config.ownerId!, config.credentialVersion ?? 1)) throw new Error("The model gateway was disconnected or revoked.");
    const [count] = await tx.select({ total: sql<number>`count(*)` }).from(gatewayRequests).where(eq(gatewayRequests.buildId, build.id));
    if (Number(count.total) >= MAX_REQUESTS) throw new Error("The model gateway build request limit was reached.");
    await tx.insert(gatewayRequests).values({ id, gatewayId: config.gatewayId!, userId: config.ownerId!, buildId: build.id, payload, expiresAt: new Date(Date.now() + REQUEST_MS) });
  });
  try {
    const until = Date.now() + REQUEST_MS;
    while (!signal.aborted && Date.now() < until) {
      const [row] = await db.select({ status: gatewayRequests.status, result: gatewayRequests.result }).from(gatewayRequests).where(eq(gatewayRequests.id, id));
      if (row?.status === "completed" && row.result) return row.result;
      if (!row || !["pending", "claimed"].includes(row.status)) throw new Error("The model gateway request was revoked or stopped.");
      await delay(500, undefined, { signal }).catch(() => undefined);
    }
    throw new Error("The model gateway did not respond. Reconnect it and submit the build again.");
  } finally { await db.update(gatewayRequests).set({ payload: {}, result: null, status: "closed", responseHash: null }).where(eq(gatewayRequests.id, id)); }
}
