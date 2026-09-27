// Fans newly discovered DEX pools out to the watchers that asked for them.
// Runs in the registry daemon, after the pool scans; the outbox rows it writes
// are sent by the Watch daemon's ordinary deliver loop.
//
// There is no cursor. A delivery is keyed on (watcher, poolId), so a pool
// already sent cannot be sent again, and a pool whose depth is read hours
// after discovery is still caught. A watcher hears only about pools found
// after it existed.
//
// No "server-only", no next/*: workers/registry.ts imports this directly.

import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexTokens, registryAssets, watcherDeliveries, watchers } from "@/lib/db/schema";
import { APP_URL } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { RunOutcome } from "@/lib/registry/authority/runs";
import { trustForTokens } from "@/lib/registry/trust";
import type { NewPoolPayload, TrustStamp } from "@/lib/watch/types";
import { WATCH_LIMITS } from "@/lib/watch/types";
import { recordedHead } from "@/lib/registry/authority/runs";

type PoolRow = typeof dexPools.$inferSelect;
type WatcherRow = typeof watchers.$inferSelect;

interface Pool extends PoolRow {
  symbol: string | null;
  name: string | null;
  quote: string | null;
}

// Pools found after this watcher was created, oldest first, capped so a
// launchpad's busy hour becomes several runs rather than one flood. Apply
// deduplication and subscription filters before the cap, or the same first
// twenty pools starve every later launch forever.
async function poolsFor(watcher: WatcherRow): Promise<Pool[]> {
  const rows = await db
    .select({
      pool: dexPools,
      symbol: dexTokens.symbol,
      name: dexTokens.name,
      quote: registryAssets.symbol,
    })
    .from(dexPools)
    .leftJoin(dexTokens, and(eq(dexTokens.chainId, dexPools.chainId), eq(dexTokens.address, dexPools.tokenAddress)))
    .leftJoin(registryAssets, eq(registryAssets.id, dexPools.quoteAssetId))
    .where(
      and(
        eq(dexPools.chainId, watcher.chainId),
        gt(dexPools.firstSeenAt, watcher.createdAt),
        gt(dexPools.createdBlock, watcher.lastCheckedBlock ?? BigInt(0)),
        sql`not exists (
          select 1 from watcher_deliveries d
          where d.watcher_id = ${watcher.id} and d.tx_hash = ${dexPools.id} and d.log_index = 0
        )`,
        watcher.lookalikesOnly ? sql`exists (
          select 1 from lookalike_tokens l
          where l.chain_id = ${watcher.chainId} and l.address = ${dexPools.tokenAddress}
        ) and not exists (
          select 1 from registry_assets a
          where a.chain_id = ${watcher.chainId} and a.address = ${dexPools.tokenAddress}
        )` : undefined,
        // Bound as a number: a numeric column compared against a text
        // parameter is an operator Postgres does not have.
        // A launch itself is a chain fact. A zero-threshold subscription can
        // receive it before pricing; a positive threshold needs a real read.
        Number(watcher.threshold) > 0 ? sql`${dexPools.depthUsd} >= ${Number(watcher.threshold)}` : undefined,
      ),
    )
    .orderBy(asc(dexPools.firstSeenAt), asc(dexPools.id))
    .limit(WATCH_LIMITS.newPoolsPerRun);
  return rows.map(function flatten(row) {
    return { ...row.pool, symbol: row.symbol, name: row.name, quote: row.quote };
  });
}

function toPayload(pool: Pool, trust: TrustStamp | undefined): NewPoolPayload {
  return {
    kind: "new_pool",
    chainId: pool.chainId,
    poolId: pool.id,
    venue: pool.venue,
    tokenAddress: pool.tokenAddress,
    symbol: pool.symbol,
    name: pool.name,
    quote: pool.quote,
    priceUsd: pool.priceUsd,
    depthUsd: pool.depthUsd,
    createdBlock: pool.createdBlock === null ? null : pool.createdBlock.toString(),
    firstSeenAt: pool.firstSeenAt.toISOString(),
    trust,
    tokenUrl: pool.tokenAddress ? `${APP_URL}/registry/markets/${pool.tokenAddress}` : `${APP_URL}/registry/markets`,
    explorerUrl: pool.poolAddress ? explorerAddressUrl(pool.chainId, pool.poolAddress) : null,
  };
}

export async function matchNewPools(chainId: number): Promise<RunOutcome> {
  const subscribers = await db
    .select()
    .from(watchers)
    .where(and(eq(watchers.chainId, chainId), eq(watchers.enabled, true), eq(watchers.kind, "new_pool")));
  if (subscribers.length === 0) {
    return { rows: 0, detail: { watchers: 0, deliveries: 0 } };
  }
  let deliveries = 0;
  let considered = 0;
  for (const watcher of subscribers) {
    // Old subscriptions lack a chain boundary. Begin from the current indexed
    // head rather than labelling pools from a historical backfill as launches.
    if (watcher.lastCheckedBlock === null) {
      const head = await recordedHead(chainId);
      if (!head) {
        throw new Error("New-pool subscriptions need a current chain head before matching");
      }
      await db.update(watchers).set({ lastCheckedBlock: head.block, status: "active", updatedAt: new Date() })
        .where(eq(watchers.id, watcher.id));
      watcher.lastCheckedBlock = head.block;
    }
    const pools = await poolsFor(watcher);
    considered += pools.length;
    if (pools.length === 0) {
      continue;
    }
    const stamps = await trustForTokens(
      chainId,
      pools.map((pool) => pool.tokenAddress).filter((address): address is string => address !== null),
    );
    const wanted = pools.filter(function keep(pool) {
      const level = pool.tokenAddress ? stamps.get(pool.tokenAddress)?.level : undefined;
      return !watcher.lookalikesOnly || level === "lookalike";
    });
    if (wanted.length === 0) {
      continue;
    }
    const inserted = await db
      .insert(watcherDeliveries)
      .values(
        wanted.map(function row(pool) {
          const verdict = pool.tokenAddress ? stamps.get(pool.tokenAddress) : undefined;
          const stamp: TrustStamp | undefined = verdict
            ? { level: verdict.level, impersonates: verdict.impersonates ? { symbol: verdict.impersonates.symbol, address: verdict.impersonates.address } : null }
            : undefined;
          return {
            id: `dl_${randomUUID()}`,
            watcherId: watcher.id,
            userId: watcher.userId,
            // The pool id stands in for a tx hash in the idempotency key, so a
            // pool cannot be announced to the same watcher twice.
            txHash: pool.id,
            logIndex: 0,
            blockNumber: pool.createdBlock ?? BigInt(0),
            blockHash: "",
            payload: toPayload(pool, stamp),
            status: "pending" as const,
          };
        }),
      )
      .onConflictDoNothing()
      .returning({ id: watcherDeliveries.id });
    deliveries += inserted.length;
  }
  return { rows: considered, detail: { watchers: subscribers.length, deliveries } };
}
