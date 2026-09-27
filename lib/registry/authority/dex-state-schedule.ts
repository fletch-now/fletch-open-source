import { and, eq, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexTokens, marketPoolSwapMetrics } from "@/lib/db/schema";
import { STATE_RETRY_MAX_MS } from "./dex-state-retry";
import { POOL_STATE_FRESH_MS } from "./dex-state-freshness";

// This is the existing state-read cap, shared by both selection lanes.
export const STATE_READ_BATCH = 1_000;

export function allocatePoolStateReads<T extends { id: string }>(preferred: readonly T[], oldest: readonly T[], limit: number): T[] {
  const selected = new Map<string, T>();
  let preferredIndex = 0;
  let oldestIndex = 0;
  while (selected.size < limit) {
    while (preferredIndex < preferred.length && selected.has(preferred[preferredIndex].id)) preferredIndex++;
    while (oldestIndex < oldest.length && selected.has(oldest[oldestIndex].id)) oldestIndex++;
    const usePreferred = preferredIndex < preferred.length && (selected.size % 4 !== 3 || oldestIndex >= oldest.length);
    const next = usePreferred ? preferred[preferredIndex++] : oldest[oldestIndex++];
    if (!next) break;
    selected.set(next.id, next);
  }
  return [...selected.values()];
}

// Read active pools deepest first while spending one slot in four
// on the oldest discovery backlog. Queries return at most two bounded batches;
// the job never loads the complete pool universe into its scheduling loop.
// Quiet pools are daily; dormant pools enter only through the demand queue.
export async function duePoolStateReads(chainId: number, now = new Date(), requestedLimit = STATE_READ_BATCH): Promise<(typeof dexPools.$inferSelect)[]> {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(STATE_READ_BATCH, Math.floor(requestedLimit))) : 0;
  if (limit === 0) return [];
  const preferred = and(
    isNotNull(dexPools.stateCheckedAt),
    eq(dexPools.tier, "active"),
    sql`not exists (select 1 from ${dexTokens} where ${dexTokens.chainId} = ${chainId} and ${dexTokens.address} = ${dexPools.tokenAddress} and ${dexTokens.hidden})`,
  );
  const due = and(
    eq(dexPools.chainId, chainId), eq(dexPools.canonical, true),
    ne(dexPools.tier, "dormant"),
    or(isNull(dexPools.stateRetryAt), lte(dexPools.stateRetryAt, now), sql`${dexPools.stateRetryAt} > ${new Date(now.getTime() + STATE_RETRY_MAX_MS).toISOString()}`),
    or(
      isNull(dexPools.stateCheckedAt),
      sql`${dexPools.stateCheckedAt} > ${now.toISOString()}`,
      and(eq(dexPools.tier, "active"), lte(dexPools.stateCheckedAt, new Date(now.getTime() - POOL_STATE_FRESH_MS))),
      and(eq(dexPools.tier, "quiet"), lte(dexPools.stateCheckedAt, new Date(now.getTime() - 86_400_000))),
    ),
  );
  // Ordering hints have their own age limit; they never mark a pool current.
  // Legacy volumeUsd24h is excluded because it valued history at today's price.
  const measuredVolume = sql`(select ${marketPoolSwapMetrics.volumeUsd} from ${marketPoolSwapMetrics}
    where ${marketPoolSwapMetrics.chainId}=${chainId} and ${marketPoolSwapMetrics.poolId}=${dexPools.id}
      and ${marketPoolSwapMetrics.coverageComplete} and ${marketPoolSwapMetrics.asOfAt} between ${new Date(now.getTime() - 3_600_000).toISOString()} and ${now.toISOString()}
      and ${marketPoolSwapMetrics.volumeUsd} >= 0)`;
  const recentDepth = sql`case when ${dexPools.stateCheckedAt} between ${new Date(now.getTime() - 86_400_000).toISOString()} and ${now.toISOString()} then ${dexPools.depthUsd} end`;
  const order = [sql`${dexPools.stateCheckedAt} asc nulls first`, dexPools.firstSeenAt, dexPools.id];
  const [priorityRows, oldestRows] = await Promise.all([
    db.select().from(dexPools).where(and(due, preferred)).orderBy(sql`${measuredVolume} desc nulls last`, sql`${recentDepth} desc nulls last`, ...order).limit(limit),
    db.select().from(dexPools).where(due).orderBy(...order).limit(limit),
  ]);
  return allocatePoolStateReads(priorityRows, oldestRows, limit);
}
