// Read paths for the dashboard and the API routes (docs/MVP.md, ticket 4).
//
// No "server-only", no next/*, no React, no lib/dal — see lib/watch/create.ts.

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { watcherDeliveries, watchers, webhookEndpoints } from "@/lib/db/schema";
import type { DeliveryChannel, DeliveryPayload, DeliveryStatus, WatcherKind, WatcherStatus } from "@/lib/watch/types";

export interface WatcherLastDelivery {
  createdAt: Date;
  status: DeliveryStatus;
  sentAt: Date | null;
  amount: string | null;
  txHash: string;
}

export interface WatcherRow {
  id: string;
  projectId: string | null;
  name: string;
  kind: WatcherKind;
  chainId: number;
  address: string;
  assetId: string | null;
  threshold: string;
  // wallet_activity only; null for large_transfer.
  wallet: string | null;
  // Where this watcher's alerts go, and — for a webhook — which endpoint, with
  // its name so a list can say the target without a second query.
  delivery: DeliveryChannel;
  webhookId: string | null;
  webhookName: string | null;
  enabled: boolean;
  status: WatcherStatus;
  // bigint columns don't survive JSON.stringify — stringified here, once, so
  // every caller (route handlers included) gets a value safe to serialize.
  lastCheckedBlock: string | null;
  lastTriggeredAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastDelivery: WatcherLastDelivery | null;
}

type LastDeliveryQueryRow = {
  watcher_id: string;
  // Epoch milliseconds, not a timestamp: drizzle's raw `execute` leaves
  // timestamps as the driver's strings ("2026-09-04 15:44:57.453"), which a
  // client component's `new Date(...)` would then read in local time. The column
  // carries no zone and `now()` wrote it in the session's, so it is converted
  // back through that same zone; `extract(epoch ...)` alone would read the
  // wall-clock value as if it were UTC and be off by the offset.
  sent_at_ms: string | null;
  created_at_ms: string;
  status: DeliveryStatus;
  amount: string | null;
  tx_hash: string;
};

// One row per watcher, its most recent delivery (any status) picked with a
// window function so this stays a single grouped query instead of N+1.
async function lastDeliveriesByWatcher(watcherIds: string[]): Promise<Map<string, WatcherLastDelivery>> {
  const byWatcher = new Map<string, WatcherLastDelivery>();
  if (watcherIds.length === 0) {
    return byWatcher;
  }

  const ranked = await db.execute<LastDeliveryQueryRow>(sql`
    SELECT watcher_id, status, (extract(epoch from created_at at time zone current_setting('TimeZone')) * 1000)::bigint AS created_at_ms, (extract(epoch from sent_at at time zone current_setting('TimeZone')) * 1000)::bigint AS sent_at_ms, payload ->> 'amount' AS amount, tx_hash
    FROM (
      SELECT
        watcher_id,
        sent_at,
        created_at,
        status,
        payload,
        tx_hash,
        row_number() OVER (PARTITION BY watcher_id ORDER BY created_at DESC) AS rn
      FROM watcher_deliveries
      WHERE watcher_id IN ${watcherIds}
    ) ranked
    WHERE rn = 1
  `);

  for (const row of ranked.rows as LastDeliveryQueryRow[]) {
    byWatcher.set(row.watcher_id, {
      createdAt: new Date(Number(row.created_at_ms)),
      status: row.status,
      sentAt: row.sent_at_ms === null ? null : new Date(Number(row.sent_at_ms)),
      amount: row.amount,
      txHash: row.tx_hash,
    });
  }
  return byWatcher;
}

function toWatcherRow(
  row: typeof watchers.$inferSelect,
  webhookName: string | null,
  lastDelivery: WatcherLastDelivery | null,
): WatcherRow {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    kind: row.kind,
    chainId: row.chainId,
    address: row.address,
    assetId: row.assetId,
    threshold: row.threshold,
    wallet: row.wallet,
    delivery: row.delivery,
    webhookId: row.webhookId,
    webhookName,
    enabled: row.enabled,
    status: row.status,
    lastCheckedBlock: row.lastCheckedBlock === null ? null : row.lastCheckedBlock.toString(),
    lastTriggeredAt: row.lastTriggeredAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastDelivery,
  };
}

export async function listWatchersForUser(userId: string): Promise<WatcherRow[]> {
  const rows = await db
    .select({ watcher: watchers, webhookName: webhookEndpoints.name })
    .from(watchers)
    .leftJoin(webhookEndpoints, eq(webhookEndpoints.id, watchers.webhookId))
    .where(eq(watchers.userId, userId))
    .orderBy(desc(watchers.createdAt));
  if (rows.length === 0) {
    return [];
  }
  const lastByWatcher = await lastDeliveriesByWatcher(rows.map((row) => row.watcher.id));
  return rows.map((row) => toWatcherRow(row.watcher, row.webhookName, lastByWatcher.get(row.watcher.id) ?? null));
}

export async function getWatcherForUser(userId: string, id: string): Promise<WatcherRow | null> {
  const rows = await db
    .select({ watcher: watchers, webhookName: webhookEndpoints.name })
    .from(watchers)
    .leftJoin(webhookEndpoints, eq(webhookEndpoints.id, watchers.webhookId))
    .where(and(eq(watchers.id, id), eq(watchers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  const lastByWatcher = await lastDeliveriesByWatcher([row.watcher.id]);
  return toWatcherRow(row.watcher, row.webhookName, lastByWatcher.get(row.watcher.id) ?? null);
}

// ── Delivery history: the watcher detail page's run history and the alerts inbox ──

export interface DeliveryRow {
  id: string;
  watcherId: string;
  status: DeliveryStatus;
  lastError: string | null;
  createdAt: Date;
  sentAt: Date | null;
  payload: DeliveryPayload;
}

function toDeliveryRow(row: typeof watcherDeliveries.$inferSelect): DeliveryRow {
  return {
    id: row.id,
    watcherId: row.watcherId,
    status: row.status,
    lastError: row.lastError,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    payload: row.payload as DeliveryPayload,
  };
}

// Scoped by both watcherId and userId — a caller can never page in another
// account's deliveries by guessing a watcher id.
export async function listDeliveriesForWatcher(userId: string, watcherId: string, limit: number): Promise<DeliveryRow[]> {
  const rows = await db
    .select()
    .from(watcherDeliveries)
    .where(and(eq(watcherDeliveries.watcherId, watcherId), eq(watcherDeliveries.userId, userId)))
    .orderBy(desc(watcherDeliveries.createdAt))
    .limit(limit);
  return rows.map(toDeliveryRow);
}

export interface UserDeliveryRow extends DeliveryRow {
  watcherName: string;
}

function toUserDeliveryRow(row: { delivery: typeof watcherDeliveries.$inferSelect; watcherName: string }): UserDeliveryRow {
  return { ...toDeliveryRow(row.delivery), watcherName: row.watcherName };
}

// The alerts inbox: every delivery across every watcher this user owns, newest
// first, with the watcher's name joined in so the row doesn't need a second
// round trip to say which watcher it came from.
export async function listDeliveriesForUser(userId: string, limit: number): Promise<UserDeliveryRow[]> {
  const rows = await db
    .select({ delivery: watcherDeliveries, watcherName: watchers.name })
    .from(watcherDeliveries)
    .innerJoin(watchers, eq(watcherDeliveries.watcherId, watchers.id))
    .where(eq(watcherDeliveries.userId, userId))
    .orderBy(desc(watcherDeliveries.createdAt))
    .limit(limit);
  return rows.map(toUserDeliveryRow);
}

export interface DeliveryStats {
  last24h: number;
  failed24h: number;
  // Detected with nowhere to send: Telegram not linked or no bot.
  held: number;
  lastSentAt: Date | null;
}

// The alerts inbox's summary strip. One aggregate query rather than three, since
// all three numbers come from the same table scoped the same way.
export async function getDeliveryStats(userId: string): Promise<DeliveryStats> {
  // last_sent_at as epoch milliseconds, read through the session's zone, for the
  // reason lastDeliveriesByWatcher gives above.
  const result = await db.execute<{ last24h: string; failed24h: string; held: string; last_sent_at_ms: string | null }>(sql`
    SELECT
      count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS last24h,
      count(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours') AS failed24h,
      count(*) FILTER (WHERE status = 'held') AS held,
      (extract(epoch from max(sent_at) at time zone current_setting('TimeZone')) * 1000)::bigint AS last_sent_at_ms
    FROM watcher_deliveries
    WHERE user_id = ${userId}
  `);
  const row = result.rows[0];
  const lastSentAtMs = row?.last_sent_at_ms ?? null;
  return {
    last24h: row ? Number(row.last24h) : 0,
    failed24h: row ? Number(row.failed24h) : 0,
    held: row ? Number(row.held) : 0,
    lastSentAt: lastSentAtMs === null ? null : new Date(Number(lastSentAtMs)),
  };
}
