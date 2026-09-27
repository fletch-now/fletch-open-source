import { and, count, eq, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { watchers } from "@/lib/db/schema";
import { WATCH_LIMITS, type WatcherKind } from "@/lib/watch/types";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class WatchLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WatchLimitError";
  }
}

// Creation, individual resume and endpoint resume share this transaction lock.
// A count inside a transaction alone does not prevent concurrent overbooking.
export async function lockWatcherCapacity(tx: Transaction): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(4663, 500)`);
}

export async function assertWatcherCapacity(tx: Transaction, userId: string, additions: WatcherKind[]): Promise<void> {
  if (additions.length === 0) return;
  const [owned, platform] = await Promise.all([
    tx.select({ kind: watchers.kind }).from(watchers).where(and(eq(watchers.userId, userId), eq(watchers.enabled, true))),
    tx.select({ value: count() }).from(watchers).where(eq(watchers.enabled, true)),
  ]);
  if (owned.length + additions.length > WATCH_LIMITS.watchersPerUser) {
    throw new WatchLimitError(`This would exceed your limit of ${WATCH_LIMITS.watchersPerUser} active watchers. Pause another watcher first.`);
  }
  if ((platform[0]?.value ?? 0) + additions.length > WATCH_LIMITS.watchersPlatform) {
    throw new WatchLimitError("Fletch Watch is at capacity right now. Try again later.");
  }
  const newPools = owned.filter((watcher) => watcher.kind === "new_pool").length + additions.filter((kind) => kind === "new_pool").length;
  if (newPools > WATCH_LIMITS.newPoolWatchersPerUser) {
    throw new WatchLimitError("Only one new-pool watcher can be active per account.");
  }
}
