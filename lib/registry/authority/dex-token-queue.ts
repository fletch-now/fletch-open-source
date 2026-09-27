import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexTokens, registryAssets } from "@/lib/db/schema";
import { registryPriorityPools } from "@/lib/db/registry-priority-schema";
import { TOKEN_READ_BATCH, TOKEN_REFRESH_MS, TOKEN_RETRY_MS, tokenFairPosition, type TokenMetadataBacklog } from "./dex-token-schedule";

const tokenOnRecord = "orphaned" in dexTokens ? sql`not t.orphaned` : sql`true`;

// Keep the catalog in PostgreSQL. Scheduling lanes return at most one
// batch; the coverage report is an aggregate, not a second catalog download.
function candidates(chainId: number, now: Date, priority: readonly string[] | null, poolCandidatesOnly = false): SQL {
  const filter = priority ? sql`and address = any(${sql.param([...priority])}::text[])` : sql``;
  const poolFilter = priority ? sql`and side.address=any(${sql.param([...priority])}::text[])` : sql``;
  const join = poolCandidatesOnly ? sql`left join` : sql`full join`;
  const eligible = poolCandidatesOnly || priority ? sql`true` : sql`p.address is not null or not exists (
    select 1 from ${dexPools} recorded where recorded.chain_id=${chainId} and recorded.canonical
      and (recorded.currency0=t.address or recorded.currency1=t.address))`;
  // Factory currencies identify both contracts even when a pool has no USD
  // quote or legacy token_address. Recorded stock trades promote their other
  // side; the fair lane still gives older discoveries a share of every batch.
  return sql`with verified_stocks as (
    select address from ${registryAssets} where chain_id=${chainId} and status='active' and asset_type='stock_token'
      and verified_at is not null and upper(onchain_symbol)=upper(symbol) and onchain_decimals=decimals
  ), pools as (
    select side.address, bool_or(p.tier='active' or stock.address is not null and p.last_swap_at is not null) as visible,
      bool_or(stock.address is not null and p.last_swap_at is not null) as stock_activity,
      min(p.first_seen_at) as first_seen_at, max(p.first_seen_at) as latest_pool_seen_at,
      max(p.created_block) as latest_pool_block,
      max(case when evidence.reason is null and evidence.observed_at between ${new Date(now.getTime() - 180_000).toISOString()} and ${now.toISOString()} then evidence.depth_usd end) as depth
    from ${dexPools} p cross join lateral (values(p.currency0,p.currency1),(p.currency1,p.currency0)) side(address,counterparty)
    left join verified_stocks stock on stock.address=side.counterparty
    left join ${registryPriorityPools} evidence on evidence.chain_id=p.chain_id and evidence.pool_id=p.id
      and evidence.factory_created_block=p.created_block and evidence.factory_created_hash is not distinct from p.created_block_hash
    where p.chain_id=${chainId} and p.canonical ${poolFilter} and side.address<>'0x0000000000000000000000000000000000000000'
      and (p.tier<>'dormant' or stock.address is not null and p.last_swap_at between ${new Date(now.getTime() - 86_400_000).toISOString()} and ${now.toISOString()})
      and not exists(select 1 from ${registryAssets} listed where listed.chain_id=p.chain_id and listed.address=side.address and listed.status='active')
    group by side.address
  ), candidates as (
    select coalesce(p.address,t.address) as address,t.checked_at,t.error,least(t.first_seen_at,p.first_seen_at) as first_seen_at,
      coalesce(p.visible,false) and not coalesce(t.hidden,false) as visible,coalesce(p.stock_activity,false) as stock_activity,p.depth,
      coalesce(t.hidden,false) as hidden,p.latest_pool_seen_at,p.latest_pool_block,
      (t.checked_at is null or t.checked_at > ${now.toISOString()} or t.checked_at <= ${now.toISOString()}::timestamp -
        case when t.error is null then ${TOKEN_REFRESH_MS} * interval '1 millisecond' else ${TOKEN_RETRY_MS} * interval '1 millisecond' end) as due
    from pools p ${join} (select * from ${dexTokens} t where chain_id=${chainId} and ${tokenOnRecord} ${filter}) t on t.address=p.address
    where ${eligible}
  )`;

}

export async function dueTokenReads(chainId: number, now: Date, priority: readonly string[] | null, requestedLimit: number, poolCandidatesOnly = false): Promise<string[]> {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.min(TOKEN_READ_BATCH, Math.floor(requestedLimit))) : 0;
  if (limit === 0 || priority?.length === 0) return [];
  // Requested tokens need not already have metadata or an associated pool.
  if (priority) {
    const rows = await db.execute<{ address: string }>(sql`
      select requested.address from unnest(${sql.param([...priority])}::text[]) with ordinality requested(address, position)
      left join ${dexTokens} t on t.chain_id=${chainId} and t.address=requested.address and ${tokenOnRecord}
      where t.checked_at is null or t.checked_at > ${now.toISOString()} or t.checked_at <= ${now.toISOString()}::timestamp -
        case when t.error is null then ${TOKEN_REFRESH_MS} * interval '1 millisecond' else ${TOKEN_RETRY_MS} * interval '1 millisecond' end
      order by requested.position limit ${limit}`);
    return rows.rows.map((row) => row.address);
  }
  const fairPosition = tokenFairPosition(now);
  // New factory currencies share the existing budget with active tokens and
  // the oldest backlog. Rotate all lanes so a short deadline cannot starve one.
  const result = await db.execute<{ address: string }>(sql`${candidates(chainId, now, null, poolCandidatesOnly)},
    newest as (select address, row_number() over (order by latest_pool_block desc, address) as n
      from candidates where due and checked_at is null and not hidden
        and latest_pool_seen_at between ${new Date(now.getTime() - 3_600_000).toISOString()} and ${now.toISOString()}
      order by latest_pool_block desc, address limit ${limit}),
    preferred as (select address, row_number() over (order by stock_activity desc, depth desc nulls last, checked_at asc nulls first, first_seen_at asc nulls last, address) as n
      from candidates where due and visible order by stock_activity desc, depth desc nulls last, checked_at asc nulls first, first_seen_at asc nulls last, address limit ${limit}),
    oldest as (select address, row_number() over (order by checked_at asc nulls first, first_seen_at asc nulls last, address) as n
      from candidates where due order by checked_at asc nulls first, first_seen_at asc nulls last, address limit ${limit}),
    lanes as (select address, case when exists(select 1 from newest)
        then ((n-1)/2)*4 + ((${fairPosition}+2+(n-1)%2)%4)
        else ((n-1)/3)*4 + ((n-1)%3) + case when ((n-1)%3)>=${fairPosition} then 1 else 0 end end as position from preferred
      union all select address, (n-1)*4+((${fairPosition}+1)%4) as position from newest
      union all select address, (n-1)*4+${fairPosition} as position from oldest)
    select address from lanes group by address order by min(position), address limit ${limit}`);
  return result.rows.map((row) => row.address);
}

export async function tokenMetadataBacklog(chainId: number, now: Date, priority: readonly string[] | null, poolCandidatesOnly = false): Promise<TokenMetadataBacklog> {
  const result = await db.execute<{ total: number; due: number; visible_due: number; never_read: number; errors: number; oldest_checked_at: string | null }>(sql`${candidates(chainId, now, priority, poolCandidatesOnly)}
    select count(*)::int as total, count(*) filter(where due)::int as due,
      count(*) filter(where due and visible)::int as visible_due,
      count(*) filter(where checked_at is null)::int as never_read,
      count(*) filter(where error is not null)::int as errors, to_char(min(checked_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as oldest_checked_at from candidates`);
  const row = result.rows[0];
  return { total: row.total, due: row.due, visibleDue: row.visible_due, neverRead: row.never_read, errors: row.errors,
    oldestCheckedAt: row.oldest_checked_at ? new Date(row.oldest_checked_at).toISOString() : null, measuredAt: now.toISOString() };
}
