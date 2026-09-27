import { getMarketReadClient } from "@/lib/chain/rpc";
import { checkRpcBudget } from "@/lib/ratelimit";
import { refreshDexTokens } from "./authority/dex";
import { checkMarketRpcBudget } from "./authority/market-rpc-budget";
import { db, pool } from "@/lib/db";
import { sql } from "drizzle-orm";
import { dexPools } from "@/lib/db/schema";
import { matchingPrioritySnapshot, poolStateCurrent } from "./authority/pool-state-query";
import { refreshPriorityUniverse, refreshSelectedPriorityPools } from "./priority";
import { refreshPriorityMetadata, refreshPrioritySupply } from "./priority-metadata";
import { PRIORITY_NAMES } from "./priority-model";
import { NATIVE_HOLDERS_REASON, readPriorityHolders } from "./priority-explorer-holders";
import type { HolderObservation } from "./priority-metadata";
import type { RunOutcome } from "./authority/runs";
import type { MetricCoverage } from "./authority/metric-coverage";
import { publishRegistryCoverage } from "./coverage-publisher";
import { redactSecrets } from "@/lib/redact";

export async function refreshPriorityState(chainId: number): Promise<RunOutcome> {
  let rpcCalls = 0;
  const client = getMarketReadClient(chainId, async function budget() { const result = await checkMarketRpcBudget("state"); if (result.ok) rpcCalls++; return result; });
  const detail = await refreshSelectedPriorityPools(chainId, client);
  const metricCoverage = await poolCoverage(chainId);
  return { rows: detail.pools, error: detail.failed ? `${detail.failed} priority pool or metadata reads failed` : undefined, detail: { ...detail, rpcCalls, metricCoverage } };
}

export async function refreshPriorityMembership(chainId: number): Promise<RunOutcome> {
  let rpcCalls = 0;
  const client = getMarketReadClient(chainId, async function budget() { const result = await checkMarketRpcBudget("state"); if (result.ok) rpcCalls++; return result; });
  const detail = await refreshPriorityUniverse(chainId, client);
  let coverageMeasuredAt: string | null = null;
  let coverageError: string | null = null;
  try { coverageMeasuredAt = await publishRegistryCoverage(chainId); }
  catch (error) { coverageError = redactSecrets(error instanceof Error ? error.message : "Catalog coverage publication failed").slice(0, 300); }
  const errors = [detail.failed ? `${detail.failed} priority pool or metadata reads failed` : null, coverageError].filter(Boolean);
  return { rows: detail.pools, error: errors.length ? errors.join("; ") : undefined, detail: { ...detail, rpcCalls, coverageMeasuredAt, coverageError } };
}

export async function poolCoverage(chainId: number): Promise<Record<string, MetricCoverage>> {
  const result = await pool.query<MetricCoverage & { metric: string }>(`with inputs as (
      select pp.observed_at as at,pp.reason,pp.price_usd,pp.depth_usd,pp.quote_observation,
        (pp.quote_observation->>'expiresAt')::timestamptz as quote_expires_at,
        (pp.quote_observation->>'sourceAt')::timestamptz as quote_source_at,
        (pp.quote_observation->>'fetchedAt')::timestamptz as quote_fetched_at
      from registry_priority_pools pp join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
        and p.created_block=pp.factory_created_block and p.created_block_hash is not distinct from pp.factory_created_hash
      where pp.chain_id=$1 and pp.selected
    ) select metric,count(*)::int as eligible,
      count(*) filter(where reason is null and value is not null and at between now()-interval '3 minutes' and now()
        and (quote_observation is null or coalesce(quote_expires_at>=now() and quote_fetched_at<=now()
          and (quote_source_at is null and quote_observation->>'method'='fixed_notional_usdg' or quote_source_at<=now())
          and quote_observation->>'value' is not null and quote_observation->>'reason' is null,false)))::int as current,
      count(*) filter(where reason is not null)::int as failed,
      count(*) filter(where at is null)::int as unread,
      case when min(least(at,quote_source_at,quote_fetched_at)) is null then null
        else greatest(0,extract(epoch from now()-min(least(at,quote_source_at,quote_fetched_at))))::float8 end as "oldestInputAgeSeconds",
      now()::text as "measuredAt"
    from inputs cross join lateral (values ('price',price_usd),('depth',depth_usd)) metrics(metric,value) group by metric`, [chainId]);
  return Object.fromEntries(result.rows.map(({ metric, ...row }) => [metric, { ...row, measuredAt: new Date(row.measuredAt).toISOString() }]));
}

async function tokenCoverage(chainId: number, metric: "metadata" | "supply" | "burn"): Promise<MetricCoverage> {
  const field = metric === "metadata" ? "o.metadata" : `o.metadata->'${metric}'`;
  const failure = metric === "metadata" ? "coalesce(o.metadata->>'metadataError',o.metadata->>'reason')" : `o.metadata->>'${metric === "supply" ? "supplyError" : "burnError"}'`;
  const expiry = metric === "metadata" ? "24 hours" : "5 minutes";
  const result = await pool.query<MetricCoverage>(`with inputs as (
      select (${field}->>'asOf')::timestamptz as at, ${failure} as error,
        ${field}->>'reason' as reason, ${field} is null as unread
      from registry_priority_tokens p left join registry_token_observations o on o.chain_id=p.chain_id and o.address=p.address
      where p.chain_id=$1 and p.role<>'alternative'
    ) select count(*)::int as eligible,
      count(*) filter(where not unread and reason is null and at between now()-interval '${expiry}' and now())::int as current,
      count(*) filter(where error is not null)::int as failed,
      count(*) filter(where unread or at is null)::int as unread,
      case when min(at) is null then null else greatest(0,extract(epoch from now()-min(at)))::float8 end as "oldestInputAgeSeconds",now()::text as "measuredAt" from inputs`, [chainId]);
  const row = result.rows[0];
  return { ...row, measuredAt: new Date(row.measuredAt).toISOString() };
}

export async function refreshDiscoveredTokenMetadata(chainId: number): Promise<RunOutcome> {
  // Twelve probes per minute leave a small continuous admission share under the global daily cap.
  return refreshDexTokens(chainId, undefined, { limit: 12, workMs: 20_000, poolCandidatesOnly: true });
}

export async function refreshPriorityTokenMetadata(chainId: number): Promise<RunOutcome> {
  const due = await pool.query<{ address: string }>(`select p.address from registry_priority_tokens p
    left join registry_token_observations o on o.chain_id=p.chain_id and o.address=p.address
    where p.chain_id=$1 and p.role<>'alternative'
      and (o.metadata is null or o.metadata->>'reason' is not null or o.metadata->>'metadataError' is not null or o.metadata->>'asOf' is null
        or (o.metadata->>'asOf')::timestamptz>now() or (o.metadata->>'asOf')::timestamptz<now()-interval '24 hours')
      and (o.metadata_attempted_at is null or o.metadata_attempted_at<now()-interval '5 minutes')
    order by o.metadata_attempted_at nulls first,p.rank,p.address limit 100`, [chainId]);
  const result = due.rows.length ? await refreshPriorityMetadata(chainId, due.rows.map((row) => row.address), getMarketReadClient(chainId, checkRpcBudget)) : { read: 0, failed: 0 };
  const metadata = await tokenCoverage(chainId, "metadata");
  return { rows: result.read, error: result.failed ? `${result.failed} priority metadata reads failed` : undefined,
    detail: { ...result, scope: "priority_tokens", due: due.rows.length, metricCoverage: { metadata } } };
}

export async function refreshPriorityTokenSupply(chainId: number): Promise<RunOutcome> {
  const due = await pool.query<{ address: string }>(`select p.address from registry_priority_tokens p
    join registry_token_observations o on o.chain_id=p.chain_id and o.address=p.address
    where p.chain_id=$1 and p.role<>'alternative' and o.metadata->>'decimals' is not null
      and (o.metadata->'supply'->>'asOf' is null or o.metadata->'burn'->>'asOf' is null
        or (o.metadata->'supply'->>'asOf')::timestamptz not between now()-interval '3 minutes' and now()
        or (o.metadata->'burn'->>'asOf')::timestamptz not between now()-interval '3 minutes' and now())
      and (o.metadata->>'supplyAttemptedAt' is null or (o.metadata->>'supplyAttemptedAt')::timestamptz<now()-interval '1 minute')
    order by (o.metadata->>'supplyAttemptedAt')::timestamptz nulls first,p.rank,p.address limit 120`, [chainId]);
  let rpcCalls = 0;
  const client = getMarketReadClient(chainId, async function budget() {
    const result = await checkRpcBudget();
    if (result.ok) rpcCalls++;
    return result;
  });
  const result = due.rows.length ? await refreshPrioritySupply(chainId, due.rows.map((row) => row.address), client) : { read: 0, failed: 0 };
  const [supply, burn] = await Promise.all([tokenCoverage(chainId, "supply"), tokenCoverage(chainId, "burn")]);
  return { rows: result.read, error: result.failed ? `${result.failed} priority supply or burn reads failed` : undefined,
    detail: { ...result, due: due.rows.length, rpcCalls, batchLimit: 120, targetAgeSeconds: 300, scope: "priority_tokens", metricCoverage: { supply, burn } } };
}

export async function samplePriorityPrices(chainId: number): Promise<RunOutcome> {
  const result = await db.execute(sql`insert into dex_price_samples(pool_id,at,price_usd)
    select pp.pool_id,pp.observed_at,pp.price_usd from registry_priority_pools pp
      join ${dexPools} on ${matchingPrioritySnapshot} and ${dexPools.canonical}
    where pp.chain_id=${chainId} and pp.selected and pp.reason is null and pp.price_usd>0
      and ${poolStateCurrent}
    on conflict do nothing`);
  await pool.query("delete from dex_price_samples s using dex_pools p where s.pool_id=p.id and p.chain_id=$1 and s.at<now()-interval '48 hours'", [chainId]);
  return { rows: result.rowCount ?? 0, detail: { scope: "selected_priority_pools", source: "pinned_pool_observations", rpcCalls: 0 } };
}

export async function refreshPriorityHolderSnapshot(chainId: number): Promise<RunOutcome> {
  interface Candidate {
    address: string;
    holders: HolderObservation | null;
    holders_attempted_at: Date | null;
    major: boolean;
  }
  function valid(observation: HolderObservation | null, now: number): boolean {
    const at = observation?.asOf ? Date.parse(observation.asOf) : NaN;
    return observation !== null && Number.isSafeInteger(observation.value) && observation.value! >= 0
      && observation.reason === null && Number.isFinite(at) && at <= now;
  }
  function due(candidate: Candidate, now: number): boolean {
    if (candidate.address === "0x0000000000000000000000000000000000000000") return candidate.holders?.reason !== NATIVE_HOLDERS_REASON;
    const attempted = candidate.holders_attempted_at?.getTime();
    if (attempted !== undefined && attempted <= now && now - attempted < 15 * 60_000) return false;
    if (!valid(candidate.holders, now)) return true;
    const observation = candidate.holders!;
    const age = now - Date.parse(observation.asOf!);
    const completeRpc = /^\d+$/.test(observation.blockNumber ?? "") && /^0x[0-9a-f]{64}$/i.test(observation.blockHash ?? "");
    const freshFor = completeRpc ? 24 * 60 * 60_000 : candidate.major ? 15 * 60_000 : 6 * 60 * 60_000;
    return age >= freshFor;
  }
  // Membership is the bounded priority universe; at most 30 holder reads can run per pass.
  const candidates = await pool.query<Candidate>(`select p.address,o.holders,o.holders_attempted_at::timestamptz as holders_attempted_at,
      exists(select 1 from registry_priority_tokens member
        left join registry_token_observations named on named.chain_id=member.chain_id and named.address=member.address
        left join dex_tokens token on token.chain_id=member.chain_id and token.address=member.address
        where member.chain_id=p.chain_id and member.group_key=p.group_key and (
          regexp_replace(lower(normalize(coalesce(named.metadata->>'symbol',token.symbol,''),NFKC)),'[^a-z0-9]','','g')=any($2::text[])
          or regexp_replace(lower(normalize(coalesce(named.metadata->>'name',token.name,''),NFKC)),'[^a-z0-9]','','g')=any($2::text[]))) as major
    from registry_priority_tokens p
    left join registry_token_observations o on o.chain_id=p.chain_id and o.address=p.address
    where p.chain_id=$1 and p.role<>'alternative'
    order by o.holders_attempted_at nulls first,p.rank,p.address`, [chainId, PRIORITY_NAMES]);
  const now = new Date().getTime();
  const batch = candidates.rows.filter((candidate) => due(candidate, now))
    .sort((left, right) => Number(right.major) - Number(left.major)
      || Number(valid(left.holders, now)) - Number(valid(right.holders, now))).slice(0, 30);
  let read = 0;
  let failed = 0;
  let skipped = 0;
  let notApplicable = 0;
  for (const candidate of batch) {
    const owner = await pool.connect();
    const key = `holders:${chainId}:${candidate.address}`;
    let acquired = false;
    try {
      acquired = (await owner.query("select pg_try_advisory_lock(hashtextextended($1,55)) as acquired", [key])).rows[0].acquired;
      if (!acquired) { skipped++; continue; }
      const saved = await owner.query<Pick<Candidate, "holders" | "holders_attempted_at">>(`select o.holders,o.holders_attempted_at::timestamptz as holders_attempted_at
        from registry_priority_tokens p left join registry_token_observations o on o.chain_id=p.chain_id and o.address=p.address
        where p.chain_id=$1 and p.address=$2 and p.role<>'alternative'`, [chainId, candidate.address]);
      const current = saved.rows[0] ? { ...candidate, ...saved.rows[0] } : null;
      const checkedAt = new Date().getTime();
      if (!current || !due(current, checkedAt)) { skipped++; continue; }
      // Record the attempt before transport; a crash cannot start another immediate fetch.
      await owner.query(`insert into registry_token_observations(chain_id,address,holders_attempted_at)
        values($1,$2,clock_timestamp()) on conflict(chain_id,address) do update set holders_attempted_at=excluded.holders_attempted_at`, [chainId, candidate.address]);
      const observation = await readPriorityHolders(chainId, candidate.address);
      const native = observation.reason === NATIVE_HOLDERS_REASON;
      if (native) notApplicable++;
      else if (observation.value !== null) read++;
      else failed++;
      const preserve = !native && observation.value === null && valid(current.holders, checkedAt);
      if (!preserve) {
        await owner.query("update registry_token_observations set holders=$3 where chain_id=$1 and address=$2", [chainId, candidate.address, observation]);
      }
      // holder_scan is deliberately untouched: native scan checkpoints remain resumable.
    } finally {
      if (acquired) {
        try {
          await owner.query("select pg_advisory_unlock(hashtextextended($1,55))", [key]);
        } catch (error) {
          owner.release(true);
          throw error;
        }
      }
      owner.release();
    }
  }
  return { rows: read, error: failed ? `${failed} holder reads failed` : undefined, detail: { scope: "non_alternative_priority_tokens", due: batch.length, read, failed, skipped, notApplicable,
    source: process.env.BLOCKSCOUT_API_KEY?.trim() ? "blockscout_pro_token_counters" : "public_robinscan_token_pages", snapshotTime: "fetch_time_source_index_time_unpublished", batchLimit: 30 } };
}
