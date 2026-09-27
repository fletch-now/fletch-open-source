import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { publicReadCache } from "@/lib/public-cache";
import { readCoverageReceipt, coverageReceiptStatus } from "../coverage-receipt";

export interface SwapIndexerReading {
  mode: "live_and_backwards";
  checkedAt: string;
  newestCountedBlock: string | null;
  newestCountedAt: string | null;
  headBlock: string | null;
  headReadAt: string | null;
  lagBlocks: string | null;
  // Wall-clock age of the indexed block, independent of assumed block cadence.
  lagSeconds: number | null;
  windowStartAt: string | null;
  windowEndAt: string | null;
  current: boolean;
  tiers: Array<{
    tier: "active" | "quiet" | "dormant";
    totalPools: number;
    enrolledPools: number;
    complete24hPools: number;
  }>;
  historicalUsdAvailable: boolean;
  valuationMethods?: readonly string[];
  coverageScope?: "priority_pools";
  tiersScope?: "canonical_catalog_pools";
  catalogMeasuredAt?: string | null;
  catalogStatus?: "current" | "stale" | "unavailable";
  priorityPoolCount?: number;
  priorityComplete24hPools?: number;
  priorityValued24hPools?: number;
}

function isoTime(value: Date | string | null): string | null {
  if (value === null) return null;
  const time = value instanceof Date ? value : new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : null;
}

// One statement gives state and membership a consistent PostgreSQL snapshot.
// This reads cached projections; public traffic never scans swap logs.
interface SwapIndexerRow extends Record<string, unknown> {
    through_block: string | null;
    through_at: Date | string | null;
    window_start_at: Date | string | null;
    head_block: string | null;
    head_read_at: Date | string | null;
    tier: "active" | "quiet" | "dormant";
    total: number;
    enrolled: number;
    complete: number;
    historically_valued: number;
    priority_pool_count: number;
    priority_complete: number;
    priority_valued: number;
    priority_historically_valued: number;

}

const cachedIndexRows = publicReadCache<{ rows: SwapIndexerRow[]; checkedAt: string }>(10_000, 4);

async function readIndexRows(chainId: number, checkedAt: Date, fullCatalog = false, database: Pick<typeof db, "execute"> = db): Promise<{ rows: SwapIndexerRow[]; checkedAt: string }> {
  const result = await database.execute<SwapIndexerRow>(sql`with tiers(tier) as (values ('active'),('quiet'),('dormant')),
    priority_counts as (
      select count(*)::integer priority_pool_count,
        count(*) filter(where m.coverage_complete and m.swaps is not null and m.transactions is not null)::integer priority_complete,
        count(*) filter(where m.coverage_complete and m.volume_usd is not null)::integer priority_valued,
        count(*) filter(where m.coverage_complete and m.volume_usd is not null and m.volume_valuation->>'method'='historical_chainlink_window_start')::integer priority_historically_valued
      from registry_priority_pools pp join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
        left join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
          and m.factory_created_block=p.created_block and m.factory_created_hash is not distinct from p.created_block_hash
      where pp.chain_id=${chainId} and pp.selected
    ),
    counts as (${fullCatalog ? sql`      select p.tier,count(*)::integer total,count(m.pool_id)::integer enrolled,
        count(*) filter(where m.coverage_complete and m.swaps is not null and m.transactions is not null)::integer complete,
        count(*) filter(where m.coverage_complete and m.volume_usd is not null and m.volume_valuation->>'method'='historical_chainlink_window_start')::integer historically_valued
      from dex_pools p left join market_pool_swap_metrics m
        on m.chain_id=p.chain_id and m.pool_id=p.id and m.factory_created_block=p.created_block
        and m.factory_created_hash is not distinct from p.created_block_hash
      where p.chain_id=${chainId} and p.canonical group by p.tier` : sql`select null::text tier,0 total,0 enrolled,0 complete,0 historically_valued where false`}
    ) select s.through_block::text,s.through_at at time zone 'UTC' through_at,
      s.window_start_at at time zone 'UTC' window_start_at,
      h.head_block::text,h.checked_at at time zone 'UTC' head_read_at,t.tier,
      coalesce(c.total,0)::integer total,coalesce(c.enrolled,0)::integer enrolled,coalesce(c.complete,0)::integer complete,coalesce(c.historically_valued,0)::integer historically_valued,pc.priority_pool_count,pc.priority_complete,pc.priority_valued,pc.priority_historically_valued
    from tiers t cross join priority_counts pc left join counts c on c.tier=t.tier
      left join market_swap_index_state s on s.chain_id=${chainId}
      left join lateral (select head_block,checked_at from chain_health
        where chain_id=${chainId} order by checked_at desc limit 1) h on true`);
  return { rows: result.rows, checkedAt: checkedAt.toISOString() };
}

// Explicit observation times are used by transactional acceptance reads and
// bypass sharing. Public callers reuse the snapshot, then recompute expiry.
export async function readSwapIndexer(chainId: number, observedNow?: Date, database: Pick<typeof db, "execute"> = db): Promise<SwapIndexerReading> {
  const result = observedNow
    ? await readIndexRows(chainId, observedNow, true, database)
    : await cachedIndexRows(String(chainId), () => readIndexRows(chainId, new Date()));
  const receipt = observedNow ? null : await readCoverageReceipt(chainId);
  const now = observedNow ?? new Date();
  const catalogMeasuredAt = observedNow ? result.checkedAt : receipt?.swapIndexer.checkedAt ?? null;
  const catalogStatus = coverageReceiptStatus(catalogMeasuredAt, now.getTime());
  const first = result.rows[0];
  const newest = isoTime(first.through_at);
  const age = newest ? now.getTime() - Date.parse(newest) : null;
  const current = age !== null && age >= 0 && age <= 120_000;
  let lagBlocks: string | null = null;
  if (first.head_block !== null && first.through_block !== null && BigInt(first.head_block) >= BigInt(first.through_block)) {
    lagBlocks = (BigInt(first.head_block) - BigInt(first.through_block)).toString();
  }
  return {
    mode: "live_and_backwards",
    checkedAt: result.checkedAt,
    newestCountedBlock: first.through_block,
    newestCountedAt: newest,
    headBlock: first.head_block,
    headReadAt: isoTime(first.head_read_at),
    lagBlocks,
    lagSeconds: age !== null && age >= 0 ? Math.floor(age / 1000) : null,
    windowStartAt: isoTime(first.window_start_at),
    windowEndAt: newest,
    current,
    catalogMeasuredAt, catalogStatus,
    tiers: observedNow ? result.rows.map(function tier(row) {
      return { tier: row.tier, totalPools: row.total, enrolledPools: row.enrolled, complete24hPools: row.complete };
    }) : receipt?.swapIndexer.tiers ?? [],
    historicalUsdAvailable: current && (observedNow ? result.rows.some((row) => Number(row.historically_valued) > 0) : Number(first.priority_historically_valued) > 0),
    valuationMethods: ["usdg_nominal", "historical_chainlink_window_start"], coverageScope: "priority_pools",
    tiersScope: "canonical_catalog_pools", priorityPoolCount: first.priority_pool_count,
    priorityComplete24hPools: first.priority_complete, priorityValued24hPools: first.priority_valued,
  };
}
