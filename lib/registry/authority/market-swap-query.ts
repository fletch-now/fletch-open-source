import { sql } from "drizzle-orm";
import { dexPools, marketPoolSwapMetrics, marketSwapIndexState } from "@/lib/db/schema";

export const poolSwapMembership = sql`${marketPoolSwapMetrics.chainId}=${dexPools.chainId}
  and ${marketPoolSwapMetrics.poolId}=${dexPools.id}
  and ${marketPoolSwapMetrics.factoryCreatedBlock}=${dexPools.createdBlock}
  and ${marketPoolSwapMetrics.factoryCreatedHash} is not distinct from ${dexPools.createdBlockHash}`;

export const poolSwapCurrent = sql`coalesce(${marketPoolSwapMetrics.coverageComplete}
  and ${marketSwapIndexState.throughAt} >= now()-interval '120 seconds'
  and ${marketSwapIndexState.throughAt} <= now(),false)`;

// The list order and rendered fields use exactly the same projection. Old
// daily counters never become rolling counts just because a row was read now.
export const poolSwapColumns = {
  swaps24h: sql<number | null>`case when ${poolSwapCurrent} then ${marketPoolSwapMetrics.swaps} end`,
  transactions24h: sql<number | null>`case when ${poolSwapCurrent} then ${marketPoolSwapMetrics.transactions} end`,
  volumeValuation: sql<Record<string, unknown> | null>`case when ${marketPoolSwapMetrics.coverageComplete} and not(${poolSwapCurrent})
    then market_pool_swap_metrics.volume_valuation || jsonb_build_object('reason','stale_swap_index')
    else market_pool_swap_metrics.volume_valuation end`,
  volumeUsd24h: sql<string | null>`case when ${poolSwapCurrent} then ${marketPoolSwapMetrics.volumeUsd} end`,
  metricsAsOf: sql<Date | null>`case when ${poolSwapCurrent} then ${marketSwapIndexState.throughAt} end`.mapWith(marketSwapIndexState.throughAt),
  metricsWindowStartAt: marketSwapIndexState.windowStartAt,
  metricsCoverageComplete: sql<boolean>`coalesce(${marketPoolSwapMetrics.coverageComplete},false)`,
  metricsCurrent: poolSwapCurrent.mapWith(Boolean),
  volume0Raw: sql<string | null>`case when ${poolSwapCurrent} then ${marketPoolSwapMetrics.volume0Raw} end`,
  volume1Raw: sql<string | null>`case when ${poolSwapCurrent} then ${marketPoolSwapMetrics.volume1Raw} end`,
};
