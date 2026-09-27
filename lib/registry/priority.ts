import type { Pool, PoolClient } from "pg";
import { erc20Abi, formatUnits, zeroAddress, type Address, type PublicClient } from "viem";
import { pool } from "@/lib/db";
import type { MulticallCall } from "./authority/chain";
import { metadataFailureSummary } from "./authority/dex-token-errors";
import { getMarketReadClient } from "@/lib/chain/rpc";
import { checkMarketRpcBudget } from "./authority/market-rpc-budget";
import { STATE_VIEW_ABI, UNISWAP_V3_POOL_ABI } from "./authority/abis";
import { UNISWAP_V4_POOL_MANAGER, UNISWAP_V4_STATE_VIEW } from "./authority/constants";
import { onePctDepthUsd, withinVenueHoldings } from "./authority/depth";
import { refreshPriorityMetadata, type TokenMetadataObservation, type HolderObservation } from "./priority-metadata";
import { currentPool, PRIORITY_NAMES, PRIORITY_POOL_LIMIT, PRIORITY_STATE_FRESH_MS, selectPriority, strongestPool, type PriorityCandidate, type PriorityPool, type PriorityToken } from "./priority-model";
export type { PriorityToken } from "./priority-model";
import type { PoolQuoteObservation } from "./token-markets-types";

interface CatalogToken {
  address: string; asset_id: string | null; symbol: string | null; name: string | null;
  decimals: number | null; metadata: TokenMetadataObservation | null; metadata_attempted_at: Date | null; holders: HolderObservation | null;
}
interface CandidatePool {
  id: string; chain_id: number; venue: string; pool_address: string | null; address: string;
  currency0: string; currency1: string; created_block: string; created_block_hash: string | null; last_swap_at: Date | null;
  quote_address: string; quote_decimals: number; quote_symbol: string; quote_type: string;
  feed_price: string | null; feed_updated_at: Date | null; feed_address: string | null; feed_checked_at: Date | null; feed_stale: boolean | null;
}

export async function readPriorityPoolIds(chainId: number): Promise<string[]> {
  const result = await pool.query<{ pool_id: string }>(`select pp.pool_id from registry_priority_pools pp
    join dex_pools p on p.id=pp.pool_id and p.chain_id=pp.chain_id and p.canonical
      and pp.factory_created_block=p.created_block and pp.factory_created_hash is not distinct from p.created_block_hash
    left join dex_tokens t on t.chain_id=pp.chain_id and t.address=pp.address
    left join registry_priority_tokens pt on pt.chain_id=pp.chain_id and pt.address=pp.address
    where pp.chain_id=$1 and pp.selected order by coalesce(array_position($3::text[],lower(t.symbol)),100),pt.rank,pp.pool_id limit $2`, [chainId, PRIORITY_POOL_LIMIT, PRIORITY_NAMES]);
  return result.rows.map((row) => row.pool_id);
}

export async function readPriorityUniverse(chainId: number): Promise<PriorityToken[]> {
  const result = await pool.query(`select chain_id as "chainId",address,asset_id as "assetId",role,group_key as "groupKey",
    dominant_address as "dominantAddress",selection_reason as "selectionReason",close_call as "closeCall",rank,
    selected_at as "selectedAt" from registry_priority_tokens where chain_id=$1 order by rank,address`, [chainId]);
  return result.rows.map((row) => ({ ...row, selectedAt: new Date(row.selectedAt).toISOString() })) as PriorityToken[];
}

async function catalogNames(database: Pick<Pool, "query">): Promise<string[]> {
  const result = await database.query<{ symbol: string }>("select distinct symbol from robinhood_app_pairs where present");
  return [...PRIORITY_NAMES, ...result.rows.map((row) => row.symbol.toLowerCase().replace(/[^a-z0-9]/g, ""))];
}

async function candidatePools(chainId: number, database: PoolClient): Promise<CandidatePool[]> {
  // Stored observations only nominate bounded candidates. The fresh pinned
  // reads below decide membership; old depth is never a dominance result.
  // After the active and selected pools, older attempts rotate through the
  // catalog candidates so a busy ticker cannot monopolize the bounded pass.
  // Native currency has no ERC-20 contract. Exclude it as a token candidate,
  // while preserving native currency on either side of stored pools.
  // Joining the named set avoids a materialized IN subquery being scanned
  // again for every pool as the catalog grows.
  const result = await database.query<CandidatePool>(`with named as (
      select distinct address from dex_tokens where chain_id=$1 and not hidden and
      (lower(regexp_replace(coalesce(symbol,''),'[^a-zA-Z0-9]','','g'))=any($2)
       or lower(regexp_replace(coalesce(name,''),'[^a-zA-Z0-9]','','g'))=any($2))
    ), ranked as (
      select p.*,coalesce(a.address,p.token_address) as address,n.address is not null as catalog_named,
        row_number() over(partition by p.venue order by
          (p.last_swap_at>now()-interval '24 hours') desc nulls last,
          case when evidence.observed_at between now()-interval '3 minutes' and now() and evidence.reason is null then evidence.depth_usd end desc nulls last,p.id) as venue_rank,
        row_number() over(partition by p.venue order by p.state_attempted_at nulls first,p.created_block,p.id) as fair_rank,
        row_number() over(partition by coalesce(a.address,p.token_address),p.venue order by p.depth_usd desc nulls last,p.id) as token_rank
      from dex_pools p left join registry_assets a on a.id=p.asset_id
      left join named n on n.address=coalesce(a.address,p.token_address)
      left join registry_priority_pools evidence on evidence.chain_id=p.chain_id and evidence.pool_id=p.id
        and evidence.factory_created_block=p.created_block and evidence.factory_created_hash is not distinct from p.created_block_hash
      where p.chain_id=$1 and p.canonical and p.quote_asset_id is not null
        and coalesce(a.address,p.token_address)<>$3
        and (p.tier='active' or p.asset_id is not null or n.address is not null)
    ) select r.id,r.chain_id,r.venue,r.pool_address,r.address,r.currency0,r.currency1,r.created_block::text,r.created_block_hash,r.last_swap_at at time zone 'UTC' as last_swap_at,
      q.address as quote_address,q.decimals as quote_decimals,q.symbol as quote_symbol,q.asset_type as quote_type,
      s.feed_price,s.feed_updated_at at time zone 'UTC' as feed_updated_at,s.feed_address,s.feed_checked_at at time zone 'UTC' as feed_checked_at,s.feed_stale
    from ranked r join registry_assets q on q.id=r.quote_asset_id
      left join registry_asset_state s on s.asset_id=q.id
      left join dex_tokens t on t.chain_id=r.chain_id and t.address=r.address
    where (r.venue_rank<=160 or r.fair_rank<=12 or r.asset_id is not null and r.token_rank<=2 or r.catalog_named and r.token_rank<=4)
      and coalesce(t.hidden,false)=false and q.asset_type in ('stablecoin','wrapped_native')
    order by case when r.asset_id is not null and r.token_rank<=2 or r.venue_rank<=160
        or r.id in(select pool_id from registry_priority_pools where chain_id=$1 and selected) then 0 else 1 end,
      case when r.asset_id is null and r.venue_rank>160 then r.state_attempted_at end asc nulls first,
      (r.asset_id is not null) desc,r.venue_rank,r.id limit 1200`, [chainId, await catalogNames(database), zeroAddress]);
  return result.rows;
}

export async function readPriorityCandidates(chainId: number, connection: PoolClient): Promise<CandidatePool[]> {
  await connection.query("begin");
  try {
    // Cancel on the database too; a client-side timeout would leave the slow
    // query using a worker connection and CPU after its caller gave up.
    await connection.query("set local statement_timeout='15s'");
    const candidates = await candidatePools(chainId, connection);
    await connection.query("commit");
    return candidates;
  } catch (error) {
    await connection.query("rollback");
    throw error;
  }
}

async function selectedPools(chainId: number, database: Pool): Promise<CandidatePool[]> {
  const result = await database.query<CandidatePool>(`select p.id,p.chain_id,p.venue,p.pool_address,pp.address,p.currency0,p.currency1,
    p.created_block::text,p.created_block_hash,p.last_swap_at at time zone 'UTC' as last_swap_at,
    q.address as quote_address,q.decimals as quote_decimals,q.symbol as quote_symbol,q.asset_type as quote_type,
    s.feed_price,s.feed_updated_at at time zone 'UTC' as feed_updated_at,s.feed_address,s.feed_checked_at at time zone 'UTC' as feed_checked_at,s.feed_stale
    from registry_priority_pools pp join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
      and p.created_block=pp.factory_created_block and p.created_block_hash is not distinct from pp.factory_created_hash
    join registry_assets q on q.id=p.quote_asset_id left join registry_asset_state s on s.asset_id=q.id
    left join dex_tokens t on t.chain_id=pp.chain_id and t.address=pp.address
    left join registry_priority_tokens pt on pt.chain_id=pp.chain_id and pt.address=pp.address
    where pp.chain_id=$1 and pp.selected
    order by coalesce(array_position($3::text[],lower(t.symbol)),100),pt.rank,pp.pool_id limit $2`,[chainId,PRIORITY_POOL_LIMIT,PRIORITY_NAMES]);
  return result.rows;
}

async function storedObservations(chainId: number, candidates: CandidatePool[], database: Pool): Promise<PriorityPool[]> {
  const result = await database.query(`select pp.*,p.created_block::text,p.last_swap_at at time zone 'UTC' as last_swap_at
    from registry_priority_pools pp join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
      and p.created_block=pp.factory_created_block and p.created_block_hash is not distinct from pp.factory_created_hash
    where pp.chain_id=$1 and pp.pool_id=any($2)`,[chainId,candidates.map((row)=>row.id)]);
  return result.rows.map((row)=>({id:row.pool_id,address:row.address,method:row.method,depthUsd:row.depth_usd===null?null:Number(row.depth_usd),
    priceUsd:row.price_usd===null?null:Number(row.price_usd),observedAt:row.observed_at?.toISOString()??null,reason:row.reason,
    createdBlock:row.created_block,lastSwapAt:row.last_swap_at?.toISOString()??null}));
}

// Frequent state reads do not wait for candidate discovery or metadata work.
// Their lock is independent of the slower full-universe comparison pass.
export async function refreshSelectedPriorityPools(chainId: number, client: PublicClient = getMarketReadClient(chainId,()=>checkMarketRpcBudget("state")), database: Pool = pool): Promise<{ pools:number; candidatePools:number } & PoolReadSummary> {
  const lock=await database.connect();
  let acquired=false;
  try {
    acquired=(await lock.query("select pg_try_advisory_lock(73462056) as acquired")).rows[0].acquired;
    if(!acquired)throw new Error("Selected priority pool refresh already running");
    if(await client.getChainId()!==chainId)throw new Error("Priority RPC chain mismatch");
    const candidates=await selectedPools(chainId,database);
    if(!candidates.length)return {pools:0,candidatePools:0,failed:0,rejectedCount:0,rejectedReasons:{}};
    const tokens=await catalog(chainId,candidates.map((row)=>row.address),database);
    const observations = await observePools(chainId,candidates,tokens,client,database);
    return {pools:candidates.length,candidatePools:candidates.length,...summarizePoolReads(observations)};
  }finally{
    if(acquired)await lock.query("select pg_advisory_unlock(73462056)").catch(function ignoreRelease(){});
    lock.release();
  }
}

async function catalog(chainId: number, addresses: string[], database: Pool): Promise<CatalogToken[]> {
  const result = await database.query<CatalogToken>(`with tokens as (
    select address,id as asset_id,symbol,name,decimals from registry_assets where chain_id=$1 and status='active'
    union all select t.address,null,t.symbol,t.name,t.decimals from dex_tokens t where t.chain_id=$1 and not t.hidden
      and (t.address=any($2) or lower(regexp_replace(coalesce(t.symbol,''),'[^a-zA-Z0-9]','','g'))=any($3)
        or lower(regexp_replace(coalesce(t.name,''),'[^a-zA-Z0-9]','','g'))=any($3)) and not exists(select 1 from registry_assets a where a.chain_id=$1 and a.status='active' and a.address=t.address)
    ) select t.*,o.metadata,o.metadata_attempted_at,o.holders from tokens t left join registry_token_observations o on o.chain_id=$1 and o.address=t.address
    order by t.address`, [chainId, addresses, await catalogNames(database)]);
  return result.rows;
}

export type QuoteObservation = PoolQuoteObservation;

function quotePrice(row: CandidatePool, now: number, poolAsOf = now): QuoteObservation {
  const observation: QuoteObservation = {
    value: null, source: "Quote USD conversion unavailable: a current supported quote-price observation is required",
    sourceId: "chainlink_quote_feed", sourceAt: row.feed_updated_at?.toISOString() ?? null,
    fetchedAt: row.feed_checked_at?.toISOString() ?? null,
    expiresAt: row.feed_checked_at ? new Date(row.feed_checked_at.getTime() + 180_000).toISOString() : null,
    method: "quote_token_usd_feed", blockNumber: null, blockHash: null,
    parameters: { quoteAddress: row.quote_address, quoteDecimals: row.quote_decimals, feedAddress: row.feed_address, feedStale: row.feed_stale }, reason: "A current supported quote-price observation is required.",
  };
  if (row.quote_type === "stablecoin" && row.quote_symbol === "USDG") {
    return { ...observation, value: 1, source: "USDG notional at 1 USDG = $1; no depeg adjustment", sourceId: "usdg_notional",
      sourceAt: null, fetchedAt: new Date(now).toISOString(), expiresAt: new Date(poolAsOf + 180_000).toISOString(),
      method: "fixed_notional_usdg", parameters: { quoteAddress: row.quote_address, quoteDecimals: row.quote_decimals, feedAddress: null, assumption: "1 USDG = 1 USD; no depeg adjustment" }, reason: null };
  }
  const age = row.feed_checked_at ? now - row.feed_checked_at.getTime() : Infinity;
  const value = Number(row.feed_price);
  if (row.quote_type === "wrapped_native" && row.feed_stale === false && age >= 0 && age <= 180_000 && value > 0 && Number.isFinite(value)) {
    return { ...observation, value, reason: null,
      source: `Chainlink ${row.quote_symbol}/USD feed ${row.feed_address ?? "address unavailable"}; oracle updated ${row.feed_updated_at?.toISOString() ?? "time unavailable"}; RPC checked ${row.feed_checked_at!.toISOString()}` };
  }
  return observation;
}

export function poolPrice(sqrtPriceX96: bigint, tokenIsZero: boolean, tokenDecimals: number, quoteDecimals: number, quoteUsd: number): number | null {
  const ratio = Number(sqrtPriceX96) / 2 ** 96;
  const raw = ratio * ratio;
  const price = (tokenIsZero ? raw : 1 / raw) * 10 ** (tokenDecimals - quoteDecimals) * quoteUsd;
  return price > 0 && Number.isFinite(price) ? price : null;
}

type ObservedPool = PriorityPool & { rejectedEstimate: boolean; source: string; quoteSource: string; quoteObservation: QuoteObservation; sqrtPrice: bigint | null; tick: number | null; liquidity: bigint | null };

interface PoolReadSummary {
  failed: number;
  rejectedCount: number;
  rejectedReasons: Record<string, number>;
}

// Rejecting an unsafe derived estimate is a completed validation. Preserve its
// unavailable value and explanation without reporting a source-read outage.
function summarizePoolReads(observations: ObservedPool[]): PoolReadSummary {
  const summary: PoolReadSummary = { failed: 0, rejectedCount: 0, rejectedReasons: {} };
  for (const observation of observations) {
    if (observation.reason === null) continue;
    if (observation.rejectedEstimate) {
      summary.rejectedCount++;
      summary.rejectedReasons[observation.reason] = (summary.rejectedReasons[observation.reason] ?? 0) + 1;
    } else summary.failed++;
  }
  return summary;
}

function requireCurrentPoolInputs(observations: ObservedPool[]): void {
  const now = Date.now();
  for (const row of observations) {
    if ((row.depthUsd ?? 0) <= 0 && row.priceUsd === null) continue;
    const age = row.observedAt === null ? Infinity : now - Date.parse(row.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > PRIORITY_STATE_FRESH_MS) {
      throw new Error("Priority pool snapshot expired during reads; previous selection retained");
    }
    const expiresAt = Date.parse(row.quoteObservation.expiresAt ?? "");
    if (!Number.isFinite(expiresAt) || expiresAt < now) {
      throw new Error("Priority quote expired during reads; previous selection retained");
    }
  }
}

async function refreshBatchQuotes(chainId: number, batch: CandidatePool[], database: Pool): Promise<void> {
  const addresses = [...new Set(batch.filter((row) => row.quote_type === "wrapped_native").map((row) => row.quote_address))];
  if (!addresses.length) return;
  const result = await database.query<Pick<CandidatePool, "quote_address" | "feed_price" | "feed_updated_at" | "feed_address" | "feed_checked_at" | "feed_stale">>(`
    select q.address as quote_address,s.feed_price,s.feed_updated_at at time zone 'UTC' as feed_updated_at,
      s.feed_address,s.feed_checked_at at time zone 'UTC' as feed_checked_at,s.feed_stale
    from registry_assets q left join registry_asset_state s on s.asset_id=q.id
    where q.chain_id=$1 and q.address=any($2)`, [chainId, addresses]);
  for (const row of batch) {
    const quote = result.rows.find((entry) => entry.quote_address === row.quote_address);
    if (quote) Object.assign(row, quote);
  }
}

async function observePools(chainId: number, candidates: CandidatePool[], tokens: CatalogToken[], client: PublicClient, database: Pool, quoteCapturedAt = Date.now()): Promise<ObservedPool[]> {
  const previouslyQuoted = new Set(candidates.filter((row) => quotePrice(row, quoteCapturedAt).value !== null).map((row) => row.id));
  const head = await client.getBlock({ blockTag: "latest" });
  if (head.number === null || !head.hash) throw new Error("Pool snapshot head unavailable");
  const at = new Date(Number(head.timestamp) * 1000).toISOString();
  const byAddress = new Map(tokens.map((token) => [token.address, token]));
  const observations: ObservedPool[] = [];
  for (let offset = 0; offset < candidates.length; offset += 36) {
    const batch = candidates.slice(offset, offset + 36);
    const calls = batch.flatMap<MulticallCall>((row) => row.venue === "uniswap_v3" ? [
      { address: row.pool_address as Address, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" },
      { address: row.pool_address as Address, abi: UNISWAP_V3_POOL_ABI, functionName: "liquidity" },
      { address: row.quote_address as Address, abi: erc20Abi, functionName: "balanceOf", args: [row.pool_address as Address] },
    ] : [
      { address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [row.id] },
      { address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [row.id] },
      { address: row.quote_address as Address, abi: erc20Abi, functionName: "balanceOf", args: [UNISWAP_V4_POOL_MANAGER] },
    ]);
    const results = await client.multicall({ contracts: calls, allowFailure: true, blockNumber: head.number, batchSize: 8192 });
    if (results.length !== calls.length || metadataFailureSummary(results, calls).aggregateFailures > 0) {
      throw new Error("Priority pool RPC batch unavailable; previous complete observations retained");
    }
    // Oracle refresh runs independently; re-read its persisted observation after
    // each bounded RPC batch instead of carrying the initial snapshot all run.
    await refreshBatchQuotes(chainId, batch, database);
    for (const [index, row] of batch.entries()) {
      const slot = results[index * 3]; const liquidity = results[index * 3 + 1]; const balance = results[index * 3 + 2];
      const quote = quotePrice(row, Date.now(), Number(head.timestamp) * 1000);
      if (quote.value === null && previouslyQuoted.has(row.id)
        && liquidity.status === "success" && typeof liquidity.result === "bigint" && liquidity.result > BigInt(0)) {
        throw new Error("Priority quote expired during reads; previous selection retained");
      }
      const token = byAddress.get(row.address);
      const decimals = token?.metadata?.decimals ?? token?.decimals;
      quote.parameters.tokenDecimals = decimals ?? null;
      quote.parameters.tokenDecimalsSourceAt = token?.metadata?.asOf ?? null;
      const entry: typeof observations[number] = { id: row.id, address: row.address,
        method: row.venue === "uniswap_v3" ? "v3_quote_holdings" : "v4_bounded_one_percent",
        depthUsd: null, priceUsd: null, observedAt: at, reason: null, rejectedEstimate: false, createdBlock: row.created_block,
        lastSwapAt: row.last_swap_at?.toISOString() ?? null,
        source: row.venue === "uniswap_v3" ? "Pinned RPC quote-token balanceOf the V3 pool; holdings include fees and are not executable trade depth"
          : "Pinned RPC V4 active-liquidity 1% upper-bound estimate, rejected if above singleton quote holdings; not TVL or an executable quote",
        quoteSource: quote.source ?? "Quote source unavailable", quoteObservation: quote, sqrtPrice: null, tick: null, liquidity: null };
      if (slot.status === "success" && Array.isArray(slot.result) && typeof slot.result[0] === "bigint" && typeof slot.result[1] === "number"
        && liquidity.status === "success" && typeof liquidity.result === "bigint") {
        entry.sqrtPrice = slot.result[0]; entry.tick = slot.result[1]; entry.liquidity = liquidity.result;
      }
      if (slot.status !== "success" || !Array.isArray(slot.result) || liquidity.status !== "success" || typeof liquidity.result !== "bigint" || balance.status !== "success" || typeof balance.result !== "bigint") entry.reason = "A required pinned pool-state or quote-balance RPC call failed.";
      else if (quote.value === null) entry.reason = quote.reason ?? quote.source;
      else {
        const sqrtPrice = slot.result[0] as bigint;
        const holds = Number(formatUnits(balance.result, row.quote_decimals)) * quote.value;
        if (row.venue === "uniswap_v3") entry.depthUsd = Number.isFinite(holds) && holds >= 0 ? holds : null;
        else if (liquidity.result === BigInt(0)) entry.depthUsd = 0;
        else entry.depthUsd = withinVenueHoldings(onePctDepthUsd(row.currency1, { address: row.quote_address, decimals: row.quote_decimals }, sqrtPrice, liquidity.result, quote.value), holds);
        if (entry.depthUsd === null) {
          entry.reason = "The 1% estimate exceeds observable venue holdings or cannot be bounded.";
          entry.rejectedEstimate = true;
        }
        if (decimals !== null && decimals !== undefined && liquidity.result > BigInt(0)) entry.priceUsd = poolPrice(sqrtPrice, row.currency0 === row.address, decimals, row.quote_decimals, quote.value);
      }
      observations.push(entry);
    }
  }
  if ((await client.getBlock({ blockNumber: head.number })).hash !== head.hash) throw new Error("Pool snapshot changed during reads; observations not published");
  requireCurrentPoolInputs(observations);
  for (const entry of observations) {
    const creation = candidates.find((candidate) => candidate.id === entry.id)!;
    const written = await database.query(`insert into registry_priority_pools(chain_id,pool_id,address,method,depth_usd,price_usd,source,reason,observed_at,attempted_at,block_number,block_hash,quote_price_source,factory_created_block,factory_created_hash,quote_observation)
      select $1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10,$11,$12,$13,$14,$15
      from dex_pools canonical where canonical.chain_id=$1 and canonical.id=$2 and canonical.canonical
        and canonical.created_block=$13 and canonical.created_block_hash is not distinct from $14
      on conflict(chain_id,pool_id) do update set address=excluded.address,method=excluded.method,depth_usd=excluded.depth_usd,
      price_usd=excluded.price_usd,source=excluded.source,reason=excluded.reason,observed_at=excluded.observed_at,attempted_at=excluded.attempted_at,
      block_number=excluded.block_number,block_hash=excluded.block_hash,quote_price_source=excluded.quote_price_source,quote_observation=excluded.quote_observation,factory_created_block=excluded.factory_created_block,factory_created_hash=excluded.factory_created_hash
      where registry_priority_pools.factory_created_block<>excluded.factory_created_block
        or registry_priority_pools.factory_created_hash is distinct from excluded.factory_created_hash
        or registry_priority_pools.block_number is null or excluded.block_number>registry_priority_pools.block_number
        or excluded.block_number=registry_priority_pools.block_number and excluded.block_hash=registry_priority_pools.block_hash`,
    [chainId, entry.id, entry.address, entry.method, entry.depthUsd, entry.priceUsd, entry.source, entry.reason, entry.observedAt, head.number.toString(), head.hash, entry.quoteSource, creation.created_block, creation.created_block_hash, entry.quoteObservation]);
    if (!written.rowCount) continue;
    // The pool drilldown and selected-token view use the same pinned state.
    // Creation identity fences this mirror against a concurrent factory reorg.
    await database.query(`update dex_pools set sqrt_price_x96=$5,tick=$6,liquidity=$7,price_usd=$8,depth_usd=$9,
      price_in_quote=$10,state_attempted_at=clock_timestamp(),
      state_checked_at=case when $5::numeric is not null and $7::numeric is not null then $11::timestamp else state_checked_at end,
      state_failures=case when $12::text is null then 0 else state_failures+1 end,
      state_retry_at=case when $12::text is null then null else clock_timestamp()+interval '5 minutes' end
      where chain_id=$1 and id=$2 and canonical and created_block=$3 and created_block_hash is not distinct from $4
        and exists(select 1 from registry_priority_pools pp where pp.chain_id=$1 and pp.pool_id=$2 and pp.block_number=$13 and pp.block_hash=$14)`,
      [chainId,entry.id,creation.created_block,creation.created_block_hash,entry.sqrtPrice?.toString() ?? null,entry.tick,
        entry.liquidity?.toString() ?? null,entry.priceUsd,entry.depthUsd,
        entry.priceUsd !== null && entry.quoteObservation.value !== null ? entry.priceUsd / entry.quoteObservation.value : null,
        entry.observedAt,entry.rejectedEstimate ? null : entry.reason,head.number.toString(),head.hash]);
  }
  return observations;
}

export async function refreshPriorityUniverse(chainId: number, client: PublicClient = getMarketReadClient(chainId, () => checkMarketRpcBudget("state")), database: Pool = pool): Promise<{ listed: number; community: number; alternatives: number; pools: number; candidatePools: number; phaseMs: Record<string, number> } & PoolReadSummary> {
  const lock = await database.connect();
  try {
    if (!(await lock.query("select pg_try_advisory_lock(73462055) as acquired")).rows[0].acquired) throw new Error("Priority refresh already running");
    if (await client.getChainId() !== chainId) throw new Error("Priority RPC chain mismatch");
    const startedAt = Date.now();
    const candidates = await readPriorityCandidates(chainId, lock);
    const candidatesAt = Date.now();
    const quoteCapturedAt = Date.now();
    const addresses = [...new Set(candidates.map((row) => row.address))];
    let tokens = await catalog(chainId, addresses, database);
    const metadataNow = Date.now();
    const due = tokens.filter((token) => {
      const age = token.metadata ? metadataNow - Date.parse(token.metadata.asOf) : Infinity;
      const attemptedAge = token.metadata_attempted_at ? metadataNow - token.metadata_attempted_at.getTime() : Infinity;
      if (token.metadata?.reason === null && token.metadata.bytecodePresent === true && age >= 0 && age < 24 * 60 * 60_000) return false;
      return attemptedAge >= 5 * 60_000 || token.metadata?.bytecodePresent === undefined;
    });
    due.sort((left, right) => Number(addresses.includes(right.address)) - Number(addresses.includes(left.address))
      || (left.metadata_attempted_at?.getTime() ?? 0) - (right.metadata_attempted_at?.getTime() ?? 0) || left.address.localeCompare(right.address));
    const metadata = due.length ? await refreshPriorityMetadata(chainId, due.slice(0, 10).map((token) => token.address), client, database) : { failed: 0 };
    tokens = await catalog(chainId, addresses, database);
    const metadataAt = Date.now();
    const reads = await observePools(chainId, candidates, tokens, client, database, quoteCapturedAt);
    const observedAt = Date.now();
    // A concurrent selected-pool pass may have newer facts than this slower run.
    const observations = await storedObservations(chainId,candidates,database);
    const now = new Date();
    const facts: PriorityCandidate[] = tokens.map((token) => ({ address: token.address, assetId: token.asset_id,
      symbol: token.metadata?.symbol ?? token.symbol, name: token.metadata?.name ?? token.name,
      holders: token.holders?.asOf && now.getTime() - Date.parse(token.holders.asOf) < 24 * 60 * 60_000 ? token.holders.value : null,
      pools: observations.filter((entry) => entry.address === token.address) }));
    const membership = selectPriority(chainId, facts, now, await catalogNames(database));
    const selectedPools: string[] = [];
    for (const entry of membership.filter((token) => token.role !== "alternative").sort((a, b) => Number(b.role === "listed") - Number(a.role === "listed") || a.rank - b.rank)) {
      const token = facts.find((candidate) => candidate.address === entry.address)!;
      const v3 = strongestPool(token, "v3_quote_holdings", now.getTime());
      const v4 = strongestPool(token, "v4_bounded_one_percent", now.getTime());
      const best = v3 && (v3.depthUsd ?? 0) >= 10_000 ? v3 : v4 ?? v3;
      if (best && currentPool(best, now.getTime())) selectedPools.push(best.id);
    }
    requireCurrentPoolInputs(reads);
    await lock.query("begin");
    try {
      await lock.query("delete from registry_priority_tokens where chain_id=$1", [chainId]);
      for (const token of membership) await lock.query(`insert into registry_priority_tokens(chain_id,address,asset_id,role,group_key,dominant_address,selection_reason,close_call,rank,selected_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [chainId, token.address, token.assetId, token.role, token.groupKey, token.dominantAddress, token.selectionReason, token.closeCall, token.rank, token.selectedAt]);
      await lock.query("update registry_priority_pools set selected=(pool_id=any($2)),selected_at=$3 where chain_id=$1", [chainId, selectedPools.slice(0, PRIORITY_POOL_LIMIT), now]);
      requireCurrentPoolInputs(reads);
      await lock.query("commit");
    } catch (error) { await lock.query("rollback"); throw error; }
    const summary = summarizePoolReads(reads);
    return { listed: membership.filter((token) => token.role === "listed").length, community: membership.filter((token) => token.role === "community").length,
      alternatives: membership.filter((token) => token.role === "alternative").length, pools: Math.min(selectedPools.length, PRIORITY_POOL_LIMIT), candidatePools: candidates.length, ...summary, failed: metadata.failed + summary.failed,
      phaseMs: { candidates: candidatesAt - startedAt, metadata: metadataAt - candidatesAt, pools: observedAt - metadataAt, membership: Date.now() - observedAt } };
  } finally {
    await lock.query("select pg_advisory_unlock(73462055)").catch(function ignoreRelease() {});
    lock.release();
  }
}
