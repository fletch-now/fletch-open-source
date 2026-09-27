import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { createPublicClient, decodeEventLog, fallback, getAbiItem, http, type AbiEvent, type Address, type Log, type PublicClient } from "viem";
import { db } from "@/lib/db";
import { dexPools, marketSwapEvents, marketSwapIndexState, marketSwapRanges } from "@/lib/db/schema";
import { looksLikeRangeError } from "@/lib/chain/logs";
import { budgetedRpcFetch } from "@/lib/chain/rpc-budget";
import { createDedicatedFetch, pacedFetch } from "@/lib/chain/pace";
import { getLogRpcUrl, PUBLIC_RPC_URLS } from "@/lib/chain/rpc";
import { checkRpcBudget } from "@/lib/ratelimit";
import { POOL_MANAGER_ABI, UNISWAP_V3_POOL_ABI } from "./abis";
import { UNISWAP_V4_POOL_MANAGER, VENUE_V3, VENUE_V4 } from "./constants";
import { writeCheckpoint, type RunOutcome } from "./runs";
import { readPriorityPoolIds } from "@/lib/registry/priority";
import { MAX_QUOTE_SAMPLE_SECONDS, nominalUsdgQuote, quoteEvidence, readHistoricalWethQuote, SWAP_USDG, SWAP_WETH, swapQuoteAddress, valueSwap, type SwapQuote } from "./market-swap-valuation";
import { assertWindowHeaders, firstBlockAfter, type TimedBlock } from "./market-swap-window";

const DAY = BigInt(86_400);
const LIVE_STEP = BigInt(20_000);
const BACKFILL_STEP = BigInt(100_000);
export const SWAP_BACKFILL_POOLS = 100;
const dedicatedFetch = createDedicatedFetch();
const clients = new Map<number, PublicClient>();
type Pool = Pick<typeof dexPools.$inferSelect, "id" | "venue" | "poolAddress" | "createdBlock" | "createdBlockHash" | "currency0" | "currency1">;
type IndexState = typeof marketSwapIndexState.$inferSelect;
type Executor = Pick<typeof db, "execute" | "insert" | "update" | "select">;

// Every network attempt in this index consumes the existing daily RPC bucket.
// Public fallback shares the public lane; neither transport retries itself.
function swapClient(chainId: number): PublicClient {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const primary = getLogRpcUrl(chainId);
  const publicUrl = PUBLIC_RPC_URLS[chainId];
  function transport(url: string): ReturnType<typeof http> {
    const lane = url === publicUrl ? pacedFetch : dedicatedFetch;
    return http(url, { retryCount: 0, timeout: 20_000, fetchFn: budgetedRpcFetch(lane, checkRpcBudget) });
  }
  const transports = [transport(primary)];
  if (publicUrl && primary !== publicUrl) transports.push(transport(publicUrl));
  // Keep the dedicated provider's range refusal so boundedWindow can narrow it.
  // A fallback error would otherwise replace that actionable response.
  const client = createPublicClient({ transport: fallback(transports, { retryCount: 0, shouldThrow: looksLikeRangeError }) });
  clients.set(chainId, client);
  return client;
}

function reader(client: PublicClient): (number: bigint, fresh?: boolean) => Promise<TimedBlock> {
  const cache = new Map<bigint, TimedBlock>();
  return async function read(number, fresh = false) {
    const cached = cache.get(number);
    if (cached && !fresh) return cached;
    const block = await client.getBlock({ blockNumber: number });
    if (!block.hash || block.number !== number) throw new Error(`Missing or mismatched swap block header ${number}`);
    const result = { number, timestamp: block.timestamp, hash: block.hash.toLowerCase() };
    cache.set(number, result);
    return result;
  };
}

export async function enrollSwapPools(chainId: number, from: bigint, poolIds?: string[]): Promise<void> {
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  if (ids.length === 0) return;
  // This INSERT SELECT snapshot is the actual membership boundary. first_seen_at
  // can be historical/backdated and is deliberately never used for enrollment.
  await db.transaction(async function enroll(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId},5151)`);
    // A re-created pool cannot reuse observations attached to its former factory
    // event. Retain that history, but withdraw its coverage before re-enrollment.
    const changed = await tx.execute<{ id: string }>(sql`select p.id from dex_pools p join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
      where p.chain_id=${chainId} and m.pool_id=any(${sql.param(ids)}::text[]) and (p.created_block is distinct from m.factory_created_block
        or p.created_block_hash is distinct from m.factory_created_hash)`);
    // Most ticks have no factory changes. Resolve the bounded IDs first so
    // PostgreSQL does not plan two whole-history updates for that empty set.
    // Unselected histories remain withheld by the projection/factory guards;
    // they are invalidated here before being enrolled again.
    if (changed.rows.length > 0) {
      const changedIds = changed.rows.map(function id(row) { return row.id; });
      await tx.execute(sql`update market_swap_events set canonical=false where chain_id=${chainId} and canonical and pool_id=any(${sql.param(changedIds)}::text[])`);
      await tx.execute(sql`update market_swap_ranges set canonical=false where chain_id=${chainId} and canonical and pool_id=any(${sql.param(changedIds)}::text[])`);
    }
    await tx.execute(sql`update market_pool_swap_metrics m set covered_from_block=${from.toString()}::bigint,
      valued_from_block=null,coverage_complete=false,volume_usd=null,volume_valuation=null
      from market_swap_index_state s where m.chain_id=${chainId} and s.chain_id=m.chain_id and m.pool_id=any(${sql.param(ids)}::text[])
      and not exists(select 1 from market_swap_ranges r where r.chain_id=m.chain_id and r.canonical
        and r.pool_id=m.pool_id and r.from_block<=s.through_block and r.through_block>=s.through_block)
      and not exists(select 1 from market_swap_ranges r where r.chain_id=m.chain_id and r.canonical
        and r.pool_id is null and r.from_block>=m.enrolled_from_block
        and r.from_block<=s.through_block and r.through_block>=s.through_block)`);
    await tx.execute(sql`insert into market_pool_swap_metrics(chain_id,pool_id,enrolled_from_block,covered_from_block,factory_created_block,factory_created_hash)
    select chain_id,id,${from.toString()}::bigint,${from.toString()}::bigint,created_block,created_block_hash from ${dexPools}
    where chain_id=${chainId} and canonical and id=any(${sql.param(ids)}::text[]) and not exists (
      select 1 from market_pool_swap_metrics m where m.chain_id=dex_pools.chain_id and m.pool_id=dex_pools.id
        and m.factory_created_block=dex_pools.created_block
        and m.factory_created_hash is not distinct from dex_pools.created_block_hash
    )
    on conflict(chain_id,pool_id) do update set
      enrolled_from_block=excluded.enrolled_from_block,covered_from_block=excluded.covered_from_block,
      factory_created_block=excluded.factory_created_block,factory_created_hash=excluded.factory_created_hash,
      coverage_complete=false,as_of_at=null,swaps=null,transactions=null,volume0_raw=null,volume1_raw=null,volume_usd=null,valued_from_block=null,volume_valuation=null
    where market_pool_swap_metrics.factory_created_block is distinct from excluded.factory_created_block
       or market_pool_swap_metrics.factory_created_hash is distinct from excluded.factory_created_hash`);
  });
}

async function enrolledPools(chainId: number, ids: string[], from: bigint): Promise<Pool[]> {
  if (ids.length === 0) return [];
  const result = await db.execute(sql`select p.id,p.venue,p.pool_address,p.created_block,p.created_block_hash,p.currency0,p.currency1
    from dex_pools p join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
    where p.chain_id=${chainId} and p.canonical and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash and m.enrolled_from_block <= ${from.toString()}::bigint
      and (p.id=any(${sql.param(ids)}::text[]) or p.pool_address=any(${sql.param(ids)}::text[]))`);
  return result.rows.map((row) => ({ id: String(row.id), venue: String(row.venue),
    currency0: String(row.currency0), currency1: String(row.currency1),
    poolAddress: row.pool_address === null ? null : String(row.pool_address), createdBlock: BigInt(String(row.created_block)),
    createdBlockHash: row.created_block_hash === null ? null : String(row.created_block_hash) }));
}

type SwapEvent = typeof marketSwapEvents.$inferInsert & { volumeUsd: string | null; valuation: Record<string, unknown> | null; logData: string; logTopics: readonly string[] };
interface Window { start: TimedBlock; end: TimedBlock; events: SwapEvent[] }
async function readWindow(chainId: number, client: PublicClient, from: bigint, through: bigint, pools?: Pool[]): Promise<Window> {
  const read = reader(client);
  const start = await read(from);
  const end = await read(through);
  assertWindowHeaders(start, end);
  const events = new Map<string, SwapEvent>();
  let wethQuote: SwapQuote | null | undefined;
  for (const venue of [VENUE_V4, VENUE_V3]) {
    const selected = pools?.filter((pool) => pool.venue === venue);
    if (selected?.length === 0) continue;
    const abi = venue === VENUE_V4 ? POOL_MANAGER_ABI : UNISWAP_V3_POOL_ABI;
    const event = getAbiItem({ abi, name: "Swap" }) as AbiEvent;
    let address: Address | Address[] | undefined;
    if (venue === VENUE_V4) address = UNISWAP_V4_POOL_MANAGER;
    else if (selected) address = selected.map((pool) => pool.poolAddress as Address);
    const logs = await client.getLogs({ address, event, fromBlock: from, toBlock: through,
      args: venue === VENUE_V4 && selected ? { id: selected.map((pool) => pool.id) } : undefined });
    const candidateKeys = logs.map((log) => venue === VENUE_V4 ? log.topics[1]?.toLowerCase() : log.address.toLowerCase()).filter((key): key is string => Boolean(key));
    const known = (selected ?? await enrolledPools(chainId, [...new Set(candidateKeys)], from)).filter((pool) => pool.venue === venue);
    const byKey = new Map(known.map((pool) => [venue === VENUE_V4 ? pool.id : pool.poolAddress!.toLowerCase(), pool]));
    const hasWeth = logs.some((log) => {
      const key = venue === VENUE_V4 ? log.topics[1]?.toLowerCase() : log.address.toLowerCase();
      const pool = key ? byKey.get(key) : undefined;
      return pool && swapQuoteAddress(chainId, pool.currency0, pool.currency1) === SWAP_WETH;
    });
    if (hasWeth && end.timestamp - start.timestamp > BigInt(MAX_QUOTE_SAMPLE_SECONDS)) throw new Error("Swap historical quote window is too wide");
    if (hasWeth && wethQuote === undefined) {
      // An unavailable oracle must not stop measured USDG legs or raw coverage.
      try { wethQuote = await readHistoricalWethQuote(client, start, end); }
      catch (error) {
        if (error instanceof Error && error.message === "Swap historical quote window is too wide") throw error;
        wethQuote = null;
      }
    }
    // A wildcard v3 topic can be emitted by arbitrary contracts. Establish its
    // factory membership before decoding; untrusted malformed logs cannot stall
    // the legitimate pool tail or trigger individual contract probes.
    const decoded = logs.flatMap(function decode(log) {
      const key = venue === VENUE_V4 ? log.topics[1]?.toLowerCase() : log.address.toLowerCase();
      if (!key || !byKey.has(key)) return [];
      const args = decodeEventLog({ abi, data: log.data, topics: log.topics }).args as unknown as { id?: string; amount0: bigint; amount1: bigint };
      return [{ log: log as Log, args, key }];
    });
    for (const { log, args, key } of decoded) {
      const pool = byKey.get(key);
      if (!pool) continue;
      if (log.removed || log.blockNumber === null || !log.blockHash || !log.transactionHash || log.logIndex === null ||
          log.blockNumber < from || log.blockNumber > through || log.blockNumber < pool.createdBlock) {
        throw new Error("Swap log has invalid canonical provenance");
      }
      const quoteAddress = swapQuoteAddress(chainId, pool.currency0, pool.currency1);
      const quote = quoteAddress === SWAP_USDG ? nominalUsdgQuote() : quoteAddress === SWAP_WETH ? wethQuote : null;
      events.set(`${log.blockHash}:${log.transactionHash}:${log.logIndex}`, {
        chainId, poolId: pool.id, blockNumber: log.blockNumber, blockHash: log.blockHash.toLowerCase(),
        txHash: log.transactionHash.toLowerCase(), logIndex: log.logIndex,
        amount0Raw: args.amount0.toString(), amount1Raw: args.amount1.toString(), canonical: true,
        volumeUsd: quote ? valueSwap(pool.currency0, pool.currency1, args.amount0, args.amount1, quote) : null,
        valuation: quote ? quoteEvidence(quote) : { quoteAddress, reason: quoteAddress ? "historical_quote_unavailable" : "unsupported_quote_currency", attemptedAt: new Date().toISOString() }, logData: log.data, logTopics: log.topics,
      });
    }
  }
  if ((await read(from, true)).hash !== start.hash || (await read(through, true)).hash !== end.hash) {
    throw new Error("Swap window changed fork before commit");
  }
  return { start, end, events: [...events.values()] };
}

async function boundedWindow(chainId: number, client: PublicClient, from: bigint, through: bigint, pools?: Pool[]): Promise<Window> {
  let end = through;
  for (let attempt = 0; ; attempt++) {
    try { return await readWindow(chainId, client, from, end, pools); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/daily rpc budget|rpc call budget|rate limit|too many requests/i.test(message) || (!looksLikeRangeError(error) && message !== "Swap historical quote window is too wide") || attempt >= 6 || end <= from) throw error;
      end = from + (end - from) / BigInt(2);
    }
  }
}

async function saveWindow(tx: Executor, chainId: number, window: Window, pools?: Pool[]): Promise<void> {
  for (let offset = 0; offset < window.events.length; offset += 500) {
    const rows = window.events.slice(offset, offset + 500).map((event) => ({
      chain_id: chainId, block_hash: event.blockHash, tx_hash: event.txHash, log_index: event.logIndex,
      pool_id: event.poolId, block_number: event.blockNumber.toString(), amount0_raw: event.amount0Raw, amount1_raw: event.amount1Raw,
      volume_usd: event.volumeUsd, valuation: event.valuation, log_data: event.logData, log_topics: event.logTopics,
    }));
    await tx.execute(sql`insert into market_swap_events(chain_id,block_hash,tx_hash,log_index,pool_id,block_number,amount0_raw,amount1_raw,volume_usd,valuation,log_data,log_topics)
      select chain_id,block_hash,tx_hash,log_index,pool_id,block_number,amount0_raw,amount1_raw,volume_usd,valuation,log_data,log_topics
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(chain_id integer,block_hash text,tx_hash text,log_index integer,pool_id text,block_number bigint,
        amount0_raw numeric,amount1_raw numeric,volume_usd numeric,valuation jsonb,log_data text,log_topics jsonb)
      on conflict(chain_id,block_hash,tx_hash,log_index) do update set canonical=true,
        volume_usd=coalesce(excluded.volume_usd,market_swap_events.volume_usd),valuation=case when excluded.volume_usd is not null then excluded.valuation when market_swap_events.volume_usd is not null then market_swap_events.valuation else excluded.valuation end,
        log_data=excluded.log_data,log_topics=excluded.log_topics`);
  }
  await tx.insert(marketSwapRanges).values((pools ?? [null]).map((pool) => ({
    id: randomUUID(), chainId, poolId: pool?.id ?? null, fromBlock: window.start.number,
    throughBlock: window.end.number, fromHash: window.start.hash, throughHash: window.end.hash,
  })));
}

export async function projectSwapMetrics(chainId: number, tx: Executor = db, poolIds?: string[]): Promise<void> {
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  // The shared tail no longer observes pools outside this set. Old history is
  // retained, but cannot inherit a new as-of time when their logs were not read.
  await tx.execute(sql`update market_pool_swap_metrics set coverage_complete=false,swaps=null,transactions=null,
    volume0_raw=null,volume1_raw=null,volume_usd=null,volume_valuation=null
    where chain_id=${chainId} and coverage_complete and not(pool_id=any(${sql.param(ids)}::text[]))`);
  // The timestamp window maps exactly to (asOf - 24h, asOf] through the first
  // qualifying block. Raw signed legs are absolute once each, never both added.
  // Materialize aggregates once. Provenance belongs in the coverage verdict:
  // joining on correlated factory fields makes Postgres estimate one pool and
  // re-run a chain-wide aggregate for each of hundreds of thousands of pools.
  await tx.execute(sql`with memberships as (
    select distinct m.enrolled_from_block from market_pool_swap_metrics m where m.chain_id=${chainId} and m.pool_id=any(${sql.param(ids)}::text[])
  ), global_coverage as materialized (
    select m.enrolled_from_block,range_agg(int8range(r.from_block,r.through_block,'[]')) covered
    from memberships m join market_swap_ranges r on r.chain_id=${chainId} and r.canonical and r.pool_id is null
      and r.from_block>=m.enrolled_from_block
    join market_swap_index_state s on s.chain_id=r.chain_id
    where r.through_block>=s.window_start_block and r.from_block<=s.through_block group by m.enrolled_from_block
  ), pool_coverage as materialized (
    select r.pool_id,range_agg(int8range(r.from_block,r.through_block,'[]')) covered
    from market_swap_ranges r join market_swap_index_state s on s.chain_id=r.chain_id
    where r.chain_id=${chainId} and r.canonical and r.pool_id=any(${sql.param(ids)}::text[])
      and r.through_block>=s.window_start_block and r.from_block<=s.through_block group by r.pool_id
  ), totals as materialized (
    select e.pool_id,count(*)::integer swaps,count(distinct e.tx_hash)::integer transactions,
      sum(abs(e.amount0_raw)) volume0,sum(abs(e.amount1_raw)) volume1,
      count(e.volume_usd)::integer valued_swaps,sum(e.volume_usd) volume_usd,
      min(e.valuation->>'sampledAt') quote_sample_from,max(e.valuation->>'sampledAt') quote_sample_to,
      min(e.valuation->>'oracleUpdatedAt') oracle_updated_from,max(e.valuation->>'oracleUpdatedAt') oracle_updated_to,
      min(e.valuation->>'source') quote_source,max((e.valuation->>'maxOracleAgeSeconds')::integer) oracle_age_limit,
      min(e.valuation->>'heartbeatSource') heartbeat_source
    from market_swap_events e join market_swap_index_state s on s.chain_id=e.chain_id
    where e.chain_id=${chainId} and e.canonical and e.pool_id=any(${sql.param(ids)}::text[]) and e.block_number between s.window_start_block and s.through_block group by e.pool_id
  ), projected as (
    select m.chain_id,m.pool_id,s.through_block,s.through_at,s.window_start_at,
      coalesce((select lower(piece) from unnest(coalesce(g.covered,'{}'::int8multirange)+coalesce(c.covered,'{}'::int8multirange)) piece
        where piece @> s.through_block),s.through_block+1) actual_covered_from,
      case when p.chain_id=4663 and ${SWAP_USDG} in (p.currency0,p.currency1) then 'usdg_nominal'
        when p.chain_id=4663 and ${SWAP_WETH} in (p.currency0,p.currency1) then 'historical_chainlink_window_start' end valuation_method,
      case when p.chain_id=4663 and ${SWAP_USDG} in (p.currency0,p.currency1) then ${SWAP_USDG}
        when p.chain_id=4663 and ${SWAP_WETH} in (p.currency0,p.currency1) then ${SWAP_WETH} end quote_address,
      case when p.currency0=${SWAP_USDG} then coalesce(t.volume0,0)/1000000::numeric
        else coalesce(t.volume1,0)/1000000::numeric end usdg_notional,
      coalesce(t.valued_swaps,0) valued_swaps,coalesce(t.volume_usd,0) historical_volume_usd,
      t.quote_sample_from,t.quote_sample_to,t.oracle_updated_from,t.oracle_updated_to,t.quote_source,t.oracle_age_limit,t.heartbeat_source,
      case when p.created_block>s.through_block or p.created_block is distinct from m.factory_created_block
        or p.created_block_hash is distinct from m.factory_created_hash then false else
        (coalesce(g.covered,'{}'::int8multirange)+coalesce(c.covered,'{}'::int8multirange))
          @> int8range(greatest(s.window_start_block,p.created_block),s.through_block,'[]') end as complete,
      coalesce(t.swaps,0) swaps,coalesce(t.transactions,0) transactions,coalesce(t.volume0,0) volume0,coalesce(t.volume1,0) volume1
    from market_pool_swap_metrics m join market_swap_index_state s on s.chain_id=m.chain_id
      join dex_pools p on p.chain_id=m.chain_id and p.id=m.pool_id left join totals t on t.pool_id=p.id
      left join global_coverage g on g.enrolled_from_block=m.enrolled_from_block left join pool_coverage c on c.pool_id=m.pool_id
    where m.chain_id=${chainId} and p.canonical and m.pool_id=any(${sql.param(ids)}::text[])
  ), values_now as (
    select *,case when complete then swaps else null end published_swaps,
      case when complete then transactions else null end published_transactions,
      case when complete then volume0 else null end published_volume0,
      case when complete then volume1 else null end published_volume1,
      case when complete and valuation_method='usdg_nominal' then usdg_notional
        when complete and valuation_method='historical_chainlink_window_start' and valued_swaps=swaps then historical_volume_usd end published_usd,
      jsonb_build_object('method',valuation_method,'quoteAddress',quote_address,
        'scope','selected_pool','estimated',valuation_method='historical_chainlink_window_start',
        'source',case when valuation_method='usdg_nominal' then 'USDG denomination: 1 USDG = 1 USD; not a market-price observation' else quote_source end,
        'maxSampleAgeSeconds',case when valuation_method='historical_chainlink_window_start' then ${MAX_QUOTE_SAMPLE_SECONDS}::integer end,
        'maxOracleAgeSeconds',oracle_age_limit,'heartbeatSource',heartbeat_source,
        'sampledFrom',quote_sample_from,'sampledThrough',quote_sample_to,
        'oracleUpdatedFrom',oracle_updated_from,'oracleUpdatedThrough',oracle_updated_to,
        'reason',case when not complete then 'incomplete_24h_swap_coverage' when valuation_method is null then 'unsupported_quote_currency'
          when valuation_method='historical_chainlink_window_start' and valued_swaps<>swaps then 'historical_quote_unavailable' end) published_valuation
      from projected
  ) update market_pool_swap_metrics m set as_of_block=v.through_block,as_of_at=v.through_at,window_start_at=v.window_start_at,
    covered_from_block=v.actual_covered_from,coverage_complete=v.complete,swaps=v.published_swaps,transactions=v.published_transactions,
    volume0_raw=v.published_volume0,volume1_raw=v.published_volume1,volume_usd=v.published_usd,volume_valuation=v.published_valuation
    from values_now v where m.chain_id=v.chain_id and m.pool_id=v.pool_id
      and row(m.covered_from_block,m.coverage_complete,m.swaps,m.transactions,m.volume0_raw,m.volume1_raw,m.volume_usd,m.volume_valuation)
      is distinct from row(v.actual_covered_from,v.complete,v.published_swaps,v.published_transactions,v.published_volume0,v.published_volume1,v.published_usd,v.published_valuation)`);
}

export interface CurrentMarketSwapMetrics {
  poolId: string;
  coverageComplete: boolean;
  current: boolean;
  metricsAsOf: Date | null;
  windowStartAt: Date | null;
  swaps24h: number | null;
  transactions24h: number | null;
  volume0Raw: string | null;
  volume1Raw: string | null;
  volumeUsd24h: string | null;
  volumeValuation: Record<string, unknown> | null;
}

// The tail transaction recomputes all projections and advances shared as-of
// evidence atomically. Unchanged zero pools need no per-minute row rewrite.
// Callers attach currency0/currency1 and independently chain-read decimals.
export async function readCurrentMarketSwapMetrics(chainId: number, poolIds: string[], now = new Date()): Promise<Map<string, CurrentMarketSwapMetrics>> {
  if (poolIds.length === 0) return new Map();
  if (poolIds.length > 500) throw new Error("A swap projection read is limited to 500 pools");
  const rows = await db.execute(sql`select m.pool_id,m.coverage_complete,m.swaps,m.transactions,m.volume0_raw,m.volume1_raw,m.volume_usd,m.volume_valuation,
    s.through_at at time zone 'UTC' through_at,s.window_start_at at time zone 'UTC' window_start_at from market_pool_swap_metrics m
    join market_swap_index_state s on s.chain_id=m.chain_id join dex_pools p on p.id=m.pool_id and p.chain_id=m.chain_id
    where m.chain_id=${chainId} and p.canonical and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash and m.pool_id=any(${sql.param(poolIds)}::text[])`);
  return new Map(rows.rows.map(function format(row) {
    const asOf = row.through_at instanceof Date ? row.through_at : new Date(String(row.through_at));
    const age = now.getTime() - asOf.getTime();
    const complete = row.coverage_complete === true;
    const current = complete && age >= 0 && age <= 120_000;
    const value: CurrentMarketSwapMetrics = {
      poolId: String(row.pool_id), coverageComplete: complete, current,
      metricsAsOf: current ? asOf : null, windowStartAt: row.window_start_at instanceof Date ? row.window_start_at : new Date(String(row.window_start_at)),
      swaps24h: current ? Number(row.swaps) : null, transactions24h: current ? Number(row.transactions) : null,
      volume0Raw: current ? String(row.volume0_raw) : null, volume1Raw: current ? String(row.volume1_raw) : null, volumeUsd24h: current && row.volume_usd !== null ? String(row.volume_usd) : null,
      volumeValuation: row.volume_valuation ? { ...(row.volume_valuation as Record<string, unknown>), ...(!current && complete ? { reason: "stale_swap_index" } : {}) } : null,
    };
    return [value.poolId, value];
  }));
}

async function reconcileFork(chainId: number, state: IndexState, client: PublicClient): Promise<boolean> {
  const read = reader(client);
  if ((await read(state.throughBlock)).hash === state.throughHash) return false;
  const candidates = await db.execute(sql`select distinct through_block,through_hash from market_swap_ranges
    where chain_id=${chainId} and canonical and through_block<=${state.throughBlock.toString()}::bigint
    order by through_block desc limit 128`);
  let ancestor: TimedBlock | null = null;
  for (const candidate of candidates.rows) {
    const block = await read(BigInt(String(candidate.through_block)));
    if (block.hash === candidate.through_hash) { ancestor = block; break; }
  }
  // An arbitrary seed height is not a proven ancestor. If retained anchors all
  // changed, withdraw every old range and rebuild coverage from the live seed.
  const provenAncestor = ancestor !== null;
  if (!ancestor) ancestor = await read(state.liveStartBlock > BigInt(0) ? state.liveStartBlock - BigInt(1) : BigInt(0));
  const recovered = ancestor;
  await db.transaction(async function rewind(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId}, 5151)`);
    const [current] = await tx.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
    if (current?.throughBlock !== state.throughBlock || current?.throughHash !== state.throughHash) throw new Error("Concurrent swap tail changed during fork reconciliation");
    await tx.update(marketSwapEvents).set({ canonical: false }).where(and(eq(marketSwapEvents.chainId, chainId),
      provenAncestor ? sql`${marketSwapEvents.blockNumber}>${recovered.number.toString()}::bigint` : sql`true`));
    await tx.update(marketSwapRanges).set({ canonical: false }).where(and(eq(marketSwapRanges.chainId, chainId),
      provenAncestor ? sql`${marketSwapRanges.throughBlock}>${recovered.number.toString()}::bigint` : sql`true`));
    await tx.execute(sql`update market_pool_swap_metrics m set enrolled_from_block=least(enrolled_from_block,${(recovered.number + BigInt(1)).toString()}::bigint),
      covered_from_block=coalesce((select lower(piece) from (
        select unnest(range_agg(int8range(r.from_block,r.through_block,'[]'))) piece from market_swap_ranges r
        where r.chain_id=m.chain_id and r.canonical and (r.pool_id=m.pool_id or (r.pool_id is null and r.from_block>=m.enrolled_from_block))
      ) ranges where piece @> ${recovered.number.toString()}::bigint),${(recovered.number + BigInt(1)).toString()}::bigint),
      coverage_complete=false,swaps=null,transactions=null,volume0_raw=null,volume1_raw=null,volume_usd=null,as_of_at=null,valued_from_block=null,volume_valuation=null
      where m.chain_id=${chainId}`);
    await tx.update(marketSwapIndexState).set({ throughBlock: recovered.number, throughHash: recovered.hash,
      throughAt: new Date(Number(recovered.timestamp) * 1000), updatedAt: new Date() }).where(eq(marketSwapIndexState.chainId, chainId));
    await writeCheckpoint(`market-swaps-live:${chainId}`, chainId, { blockNumber: recovered.number, blockHash: recovered.hash }, tx);
  });
  return true;
}

export async function marketSwapProgress(chainId: number, poolIds?: string[]): Promise<Record<string, unknown>> {
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  const result = await db.execute(sql`select s.through_block::text,s.through_at at time zone 'UTC' through_at,s.window_start_at at time zone 'UTC' window_start_at,
    p.tier,count(*)::integer pools,count(*) filter(where m.coverage_complete)::integer complete,
    count(*) filter(where m.coverage_complete and m.volume_usd is not null)::integer valued,
    count(*) filter(where m.coverage_complete and m.volume_usd is not null and m.volume_valuation->>'method'='historical_chainlink_window_start')::integer historically_valued
    from market_pool_swap_metrics m join dex_pools p on p.chain_id=m.chain_id and p.id=m.pool_id
    join market_swap_index_state s on s.chain_id=m.chain_id where m.chain_id=${chainId} and m.pool_id=any(${sql.param(ids)}::text[]) and p.canonical and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash
    group by s.through_block,s.through_at,s.window_start_at,p.tier`);
  const first = result.rows[0];
  return { mode: "live_and_backwards", newestCountedBlock: first?.through_block ?? null,
    newestCountedAt: first?.through_at ?? null, windowStartAt: first?.window_start_at ?? null,
    tiers: result.rows.map((row) => ({ tier: row.tier, enrolledPools: row.pools, complete24hPools: row.complete })),
    volumeSource: "one_quote_leg", valuationMethods: ["usdg_nominal", "historical_chainlink_window_start"], historicalUsdAvailable: result.rows.some((row) => Number(row.historically_valued) > 0), valuedPools: result.rows.reduce((sum, row) => sum + Number(row.valued), 0), backfillScope: "priority_pools_24h", dormantPolicy: "only_if_priority" };
}

export async function scanLiveMarketSwaps(chainId: number, client: PublicClient = swapClient(chainId), poolIds?: string[]): Promise<RunOutcome> {
  const stagesMs: Record<string, number> = {};
  let stageStartedAt = Date.now();
  function finishStage(name: string): void {
    const now = Date.now();
    stagesMs[name] = now - stageStartedAt;
    stageStartedAt = now;
  }
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  if (ids.length === 0) return { rows: 0, detail: { waiting: "No priority pools selected" } };
  const latest = await client.getBlockNumber();
  const head = latest > BigInt(30) ? latest - BigInt(30) : BigInt(0);
  const [state] = await db.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
  if (state && await reconcileFork(chainId, state, client)) return { rows: 0, detail: { reorgRewound: true } };
  let from = head > BigInt(2_000) ? head - BigInt(2_000) : BigInt(0);
  if (state) from = state.throughBlock + BigInt(1);
  if (from > head) return { rows: 0, detail: await marketSwapProgress(chainId, ids) };
  finishStage("headAndReconcile");
  await enrollSwapPools(chainId, from, ids);
  const pools = await enrolledPools(chainId, ids, from);
  finishStage("enrollment");
  const through = from + LIVE_STEP - BigInt(1) < head ? from + LIVE_STEP - BigInt(1) : head;
  const window = await boundedWindow(chainId, client, from, through, pools);
  finishStage("logWindow");
  const read = reader(client);
  const cutoffTime = window.end.timestamp - DAY;
  let lower = BigInt(0);
  let upperHint: bigint | undefined;
  if (state && state.windowStartBlock > BigInt(0) && state.windowStartBlock <= window.end.number && state.throughAt.getTime() <= Number(window.end.timestamp) * 1000) {
    lower = state.windowStartBlock - BigInt(1);
    upperHint = state.windowStartBlock + window.end.number - state.throughBlock;
  }
  const cutoff = await firstBlockAfter(read, window.end, cutoffTime, lower, upperHint);
  // Timestamp lookup itself takes time. Recheck the anchor after it too.
  if ((await read(window.end.number, true)).hash !== window.end.hash) throw new Error("Swap tail changed fork during timestamp lookup");
  finishStage("timestampBoundary");
  await db.transaction(async function commitTail(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId},5151)`);
    const [current] = await tx.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
    if (current?.throughBlock !== state?.throughBlock || current?.throughHash !== state?.throughHash) throw new Error("Concurrent swap tail advanced; retry next run");
    await saveWindow(tx, chainId, window, pools);
    await tx.execute(sql`update market_pool_swap_metrics set valued_from_block=coalesce(valued_from_block,${from.toString()}::bigint)
      where chain_id=${chainId} and pool_id=any(${sql.param(pools.map((pool) => pool.id))}::text[])`);
    const values = { chainId, liveStartBlock: state?.liveStartBlock ?? from, liveStartAt: state?.liveStartAt ?? new Date(Number(window.start.timestamp) * 1000),
      throughBlock: window.end.number, throughAt: new Date(Number(window.end.timestamp) * 1000), throughHash: window.end.hash,
      windowStartBlock: cutoff.number, windowStartAt: new Date(Number(cutoffTime) * 1000), updatedAt: new Date() };
    await tx.insert(marketSwapIndexState).values(values).onConflictDoUpdate({ target: marketSwapIndexState.chainId, set: values });
    await projectSwapMetrics(chainId, tx, ids);
    await writeCheckpoint(`market-swaps-live:${chainId}`, chainId, { blockNumber: window.end.number, blockHash: window.end.hash }, tx);
  });
  finishStage("commit");
  const progress = await marketSwapProgress(chainId, ids);
  finishStage("progress");
  return { rows: window.events.length, detail: { ...progress, stagesMs, headBlock: head.toString(),
    headLagBlocks: (head - window.end.number).toString(), headLagSeconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(window.end.timestamp)) } };
}

export async function backfillMarketSwaps(chainId: number, client: PublicClient = swapClient(chainId), poolIds?: string[]): Promise<RunOutcome> {
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  if (ids.length === 0) return { rows: 0, detail: { waiting: "No priority pools selected" } };
  // Old markers can precede an interior gap. Recompute the contiguous range
  // reaching the shared tail before deciding where the next history read ends.
  await db.transaction(async function recoverBoundaries(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId},5151)`);
    await projectSwapMetrics(chainId, tx, ids);
  });
  const [state] = await db.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
  if (!state) return { rows: 0, detail: { waiting: "Live swap enrollment has not started" } };
  if (await reconcileFork(chainId, state, client)) return { rows: 0, detail: { reorgRewound: true } };
  const [anchor] = await db.select().from(marketSwapRanges).where(and(eq(marketSwapRanges.chainId, chainId),
    eq(marketSwapRanges.canonical, true), eq(marketSwapRanges.throughBlock, state.throughBlock), eq(marketSwapRanges.throughHash, state.throughHash))).limit(1);
  if (!anchor) return { rows: 0, detail: { waiting: "Live tail must establish a canonical range after rewind" } };
  // The latest unvalued mined event is the pricing boundary. An inherited
  // enrolled/valued marker cannot prove that intervening events had quotes.
  const missingQuotes = sql`select e.pool_id,max(e.block_number)+1 boundary from market_swap_events e
    where e.chain_id=${chainId} and e.canonical and e.volume_usd is null and e.pool_id=any(${sql.param(ids)}::text[])
      and e.block_number between ${state.windowStartBlock.toString()}::bigint and ${state.throughBlock.toString()}::bigint
      and (e.valuation->>'attemptedAt' is null or (e.valuation->>'attemptedAt')::timestamptz<now()-interval '15 minutes')
    group by e.pool_id`;
  const boundarySql = sql`case when p.chain_id=4663 and ${SWAP_WETH} in (p.currency0,p.currency1) and ${SWAP_USDG} not in (p.currency0,p.currency1)
    then greatest(m.covered_from_block,coalesce(q.boundary,0)) else m.covered_from_block end`;
  const selected = await db.execute(sql`with missing_quotes as materialized (${missingQuotes})
    select p.id,p.venue,p.pool_address,p.created_block,p.created_block_hash,p.currency0,p.currency1,${boundarySql} covered_from_block
    from dex_pools p join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
      left join missing_quotes q on q.pool_id=p.id
    where p.chain_id=${chainId} and p.canonical and p.id=any(${sql.param(ids)}::text[]) and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash and (${boundarySql})>greatest(p.created_block,${state.windowStartBlock.toString()}::bigint)
    order by array_position(${sql.param(ids)}::text[],p.id),case p.tier when 'active' then 0 when 'quiet' then 1 else 2 end,
      (m.covered_from_block > ${state.windowStartBlock.toString()}::bigint) desc,
      case when p.state_checked_at between now()-interval '24 hours' and now() then p.depth_usd end desc nulls last,
      p.id limit ${SWAP_BACKFILL_POOLS}`);
  if (selected.rows.length === 0) return revalueMarketSwaps(chainId, client, ids);
  const boundaries = new Map(selected.rows.map((row) => [String(row.id), BigInt(String(row.covered_from_block))]));
  const boundary = [...boundaries.values()].reduce((maximum, value) => value > maximum ? value : maximum, BigInt(0));
  // Read one shared window for up to100 pending pools, even when their missing
  // events have different block numbers. Coverage is recomputed from ranges;
  // reading an already-covered portion cannot move a pool past an earlier gap.
  const pools: Pool[] = selected.rows.map((row) => ({ id: String(row.id), venue: String(row.venue), currency0: String(row.currency0), currency1: String(row.currency1), poolAddress: row.pool_address === null ? null : String(row.pool_address),
      createdBlock: BigInt(String(row.created_block)), createdBlockHash: row.created_block_hash === null ? null : String(row.created_block_hash) }));
  const createdFloor = pools.reduce((minimum, pool) => pool.createdBlock < minimum ? pool.createdBlock : minimum, boundary);
  const floor = createdFloor > state.windowStartBlock ? createdFloor : state.windowStartBlock;
  const from = boundary > BACKFILL_STEP + floor ? boundary - BACKFILL_STEP : floor;
  // Backfill must meet the prior interval. On a dense refusal shorten its LEFT
  // edge, rather than commit an isolated earlier interval with a hidden gap.
  let window: Window | null = null;
  let start = from;
  for (let attempt = 0; !window; attempt++) {
    try { window = await readWindow(chainId, client, start, boundary - BigInt(1), pools); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/daily rpc budget|rpc call budget|rate limit|too many requests/i.test(message) || (!looksLikeRangeError(error) && message !== "Swap historical quote window is too wide") || attempt >= 6 || boundary - start <= BigInt(1)) throw error;
      start += (boundary - start) / BigInt(2);
    }
  }
  const completed = window;
  if ((await reader(client)(state.throughBlock)).hash !== state.throughHash) throw new Error("Swap tail changed fork during backfill");
  await db.transaction(async function commitBackfill(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId},5151)`);
    const [current] = await tx.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
    const [retainedAnchor] = await tx.select().from(marketSwapRanges).where(and(eq(marketSwapRanges.id, anchor.id), eq(marketSwapRanges.canonical, true)));
    if (!current || current.throughBlock < state.throughBlock || !retainedAnchor) throw new Error("Swap tail rewound during backfill");
    const targets = await tx.execute(sql`with missing_quotes as materialized (${missingQuotes})
      select p.id,p.created_block,p.created_block_hash,${boundarySql} boundary from dex_pools p
      join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id left join missing_quotes q on q.pool_id=p.id
      where p.chain_id=${chainId} and p.canonical
        and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash
        and p.id=any(${sql.param(pools.map((pool) => pool.id))}::text[])`);
    if (targets.rows.length !== pools.length || pools.some((pool) => !targets.rows.some((row) => row.id === pool.id &&
        BigInt(String(row.created_block)) === pool.createdBlock && row.created_block_hash === pool.createdBlockHash &&
        BigInt(String(row.boundary)) === boundaries.get(pool.id)))) {
      throw new Error("Swap backfill targets changed; retry next run");
    }
    await saveWindow(tx, chainId, completed, pools);
    await tx.execute(sql`update market_pool_swap_metrics set covered_from_block=least(covered_from_block,${completed.start.number.toString()}::bigint),
      valued_from_block=${completed.start.number.toString()}::bigint where chain_id=${chainId}
      and pool_id=any(${sql.param(pools.map((pool) => pool.id))}::text[])`);
    await projectSwapMetrics(chainId, tx, ids);
  });
  return { rows: completed.events.length, detail: { ...await marketSwapProgress(chainId, ids), selectedPools: pools.length,
    fromBlock: completed.start.number.toString(), throughBlock: completed.end.number.toString() } };
}

// Retry failed historical reads independently from raw-log coverage. A failed
// feed cannot erase a measured USDG value, or leave a recoverable WETH gap
// permanently stuck after its raw backfill reaches the 24-hour boundary.
export async function revalueMarketSwaps(chainId: number, client: PublicClient = swapClient(chainId), poolIds?: string[]): Promise<RunOutcome> {
  const ids = poolIds ?? await readPriorityPoolIds(chainId);
  const [state] = await db.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
  if (!state || ids.length === 0) return { rows: 0, detail: { waiting: "No priority swap window" } };
  const pending = await db.execute(sql`select e.pool_id,e.block_number from market_swap_events e
    join dex_pools p on p.chain_id=e.chain_id and p.id=e.pool_id
    join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
    where e.chain_id=${chainId} and e.canonical and e.volume_usd is null and p.canonical and p.chain_id=4663
      and p.created_block=m.factory_created_block and p.created_block_hash is not distinct from m.factory_created_hash
      and ${SWAP_WETH} in (p.currency0,p.currency1) and ${SWAP_USDG} not in (p.currency0,p.currency1)
      and e.pool_id=any(${sql.param(ids)}::text[]) and e.block_number between ${state.windowStartBlock.toString()}::bigint and ${state.throughBlock.toString()}::bigint
      and (e.valuation->>'attemptedAt' is null or (e.valuation->>'attemptedAt')::timestamptz<now()-interval '15 minutes')
    order by e.block_number,e.pool_id limit 100`);
  if (pending.rows.length === 0) return { rows: 0, detail: await marketSwapProgress(chainId, ids) };
  const from = BigInt(String(pending.rows[0].block_number));
  const through = from + LIVE_STEP < state.throughBlock ? from + LIVE_STEP : state.throughBlock;
  const pools = await enrolledPools(chainId, [...new Set(pending.rows.map((row) => String(row.pool_id)))], state.throughBlock);
  const window = await boundedWindow(chainId, client, from, through, pools);
  if ((await reader(client)(state.throughBlock)).hash !== state.throughHash) throw new Error("Swap tail changed fork during valuation retry");
  await db.transaction(async function saveValuation(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${chainId},5151)`);
    const [current] = await tx.select().from(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
    if (!current || current.throughBlock !== state.throughBlock || current.throughHash !== state.throughHash) throw new Error("Swap tail changed during valuation retry");
    await saveWindow(tx, chainId, window, pools);
    await projectSwapMetrics(chainId, tx, ids);
  });
  return { rows: window.events.length, detail: { ...await marketSwapProgress(chainId, ids), valuationRetriedPools: pools.length } };
}
