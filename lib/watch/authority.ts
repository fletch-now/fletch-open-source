// Fans authority events out to the watchers that asked for them. Runs in the
// registry daemon, right after the jobs that write authority_events; the
// resulting outbox rows are sent by the Watch daemon's ordinary deliver loop,
// so Telegram delivery, retries and the dashboard need no second path.
//
// No "server-only", no next/*: workers/registry.ts imports this directly.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { authorityEvents, watcherDeliveries, watchers, robinhoodAppSync } from "@/lib/db/schema";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { APP_URL } from "@/lib/config";
import { CHAIN_WIDE_KINDS, isAuthorityEventKind } from "@/lib/registry/authority/events";
import type { RunOutcome } from "@/lib/registry/authority/runs";
import type { AuthorityPayload } from "@/lib/watch/types";
import { AUTHORITY_KINDS } from "@/lib/watch/types";

const BATCH = 200;

type EventRow = typeof authorityEvents.$inferSelect;
type WatcherRow = typeof watchers.$inferSelect;

// A registry watcher hears everything that concerns the chain or the registry;
// a token watcher hears everything about its one token.
export function subscribes(watcher: WatcherRow, event: EventRow): boolean {
  if ((event.detail as Record<string, unknown> | null)?.baseline === true) return false;
  if (watcher.kind === "listing_event") {
    return event.kind.startsWith("listing.") && event.observedAt >= watcher.createdAt && (event.detail as Record<string, unknown> | null)?.baseline !== true;
  }
  if (watcher.kind === "registry_event") {
    return isAuthorityEventKind(event.kind) && CHAIN_WIDE_KINDS.has(event.kind);
  }
  return watcher.kind === "token_event" && watcher.assetId !== null && watcher.assetId === event.assetId;
}

function toPayload(event: EventRow): AuthorityPayload {
  return {
    kind: "authority",
    chainId: event.chainId,
    eventId: event.id,
    eventKind: event.kind,
    title: event.title,
    symbol: event.symbol,
    address: event.address,
    detail: (event.detail as Record<string, unknown> | null) ?? null,
    txHash: event.txHash,
    blockNumber: event.blockNumber === null ? null : event.blockNumber.toString(),
    occurredAt: event.occurredAt.toISOString(),
    explorerUrl: event.txHash ? explorerTxUrl(event.chainId, event.txHash) : null,
    registryUrl: event.kind.startsWith("listing.") ? `${APP_URL}/registry/markets?q=${encodeURIComponent(event.symbol ?? "")}` : event.symbol ? `${APP_URL}/registry/${encodeURIComponent(event.symbol)}` : `${APP_URL}/registry/changes`,
  };
}

export async function matchAuthorityEvents(chainId: number): Promise<RunOutcome> {
  const [catalog] = await db.select().from(robinhoodAppSync).where(eq(robinhoodAppSync.id, "catalog"));
  const age = catalog?.observedAt ? Date.now() - catalog.observedAt.getTime() : null;
  const current = age !== null && age >= 0 && age <= 60_000 && !catalog?.error;
  await db.update(watchers).set({ status: current ? "active" : "degraded", lastError: current ? null : catalog?.error ?? "Robinhood catalog sync is stale or has not completed", updatedAt: new Date() })
    .where(and(eq(watchers.chainId, chainId), eq(watchers.kind, "listing_event"), eq(watchers.enabled, true)));
  const pending = await db
    .select()
    .from(authorityEvents)
    .where(and(eq(authorityEvents.chainId, chainId), isNull(authorityEvents.matchedAt)))
    .orderBy(sql`case when ${authorityEvents.kind} like 'listing.%' then 0 else 1 end`, authorityEvents.observedAt)
    .limit(BATCH);
  if (pending.length === 0) {
    return { rows: 0, detail: { deliveries: 0 } };
  }
  const subscribers = await db
    .select()
    .from(watchers)
    .where(and(eq(watchers.chainId, chainId), eq(watchers.enabled, true), inArray(watchers.kind, [...AUTHORITY_KINDS])));

  let deliveries = 0;
  for (const event of pending) {
    const targets = subscribers.filter((watcher) => subscribes(watcher, event));
    if (targets.length > 0) {
      const payload = toPayload(event);
      const inserted = await db
        .insert(watcherDeliveries)
        .values(
          targets.map(function row(watcher) {
            return {
              id: `dl_${randomUUID()}`,
              watcherId: watcher.id,
              userId: watcher.userId,
              // The event id stands in for a tx hash in the idempotency key, so
              // a re-run of the matcher cannot deliver the same event twice.
              txHash: event.id,
              logIndex: 0,
              blockNumber: event.blockNumber ?? BigInt(0),
              blockHash: "",
              payload,
              status: "pending" as const,
            };
          }),
        )
        .onConflictDoNothing()
        .returning({ id: watcherDeliveries.id });
      deliveries += inserted.length;
    }
  }
  await db
    .update(authorityEvents)
    .set({ matchedAt: new Date() })
    .where(inArray(authorityEvents.id, pending.map((event) => event.id)));
  return { rows: pending.length, detail: { deliveries, subscribers: subscribers.length } };
}
