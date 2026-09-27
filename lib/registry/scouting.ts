import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { publicReadCache } from "@/lib/public-cache";
import { readExplorerCoverage, type ExplorerScoutingCoverage } from "./explorer-coverage";

export interface ScoutingCoverage {
  measuredAt: string;
  catalogSymbols: number;
  matchedTickers: number;
  bytecodeCheckedTickers: number;
  unmatchedSymbols: string[];
  pendingPoolTokens: number;
  selectedPools: number;
  completeVolumePools: number;
  explorer?: ExplorerScoutingCoverage;
  receiptStatus?: "current" | "stale" | "unavailable";
}

// Catalog coverage scans the discovered pool catalog. Share that aggregate
// across pages and API calls, retaining its own observation time. Transaction
// callers bypass the cache so an uncommitted reading cannot escape its scope.
const cachedCoverage = publicReadCache<ScoutingCoverage>(30_000, 4);

export function readScoutingCoverage(chainId: number, database: Pick<Pool, "query"> = pool): Promise<ScoutingCoverage> {
  if (database !== pool) return measureScoutingCoverage(chainId, database);
  return cachedCoverage(String(chainId), () => measureScoutingCoverage(chainId, database));
}

export async function measureScoutingCoverage(chainId: number, database: Pick<Pool, "query">): Promise<ScoutingCoverage> {
  const measuredAt = new Date().toISOString();
  const [result, explorer] = await Promise.all([database.query<Omit<ScoutingCoverage, "measuredAt">>(`
    with catalog as (select distinct symbol from robinhood_app_pairs where present),
    contracts as (
      select upper(symbol) symbol,address,bytecode_present checked from dex_tokens where chain_id=$1 and not hidden
      union all select upper(symbol),address,verified_at is not null from registry_assets where chain_id=$1 and status='active'
    ), matches as (
      select c.symbol,count(t.address) candidates,bool_or(t.checked) checked
      from catalog c left join contracts t on t.symbol=c.symbol group by c.symbol
    ) select
      (select count(*)::integer from catalog) "catalogSymbols",
      (select count(*)::integer from matches where candidates>0) "matchedTickers",
      (select count(*)::integer from matches where checked) "bytecodeCheckedTickers",
      coalesce((select array_agg(symbol order by symbol) from matches where candidates=0),'{}'::text[]) "unmatchedSymbols",
      (select count(distinct p.token_address)::integer from dex_pools p
        where p.chain_id=$1 and p.canonical and p.token_address is not null
        and not exists(select 1 from dex_tokens t where t.chain_id=p.chain_id and t.address=p.token_address and t.symbol is not null)
        and not exists(select 1 from registry_assets a where a.chain_id=p.chain_id and a.address=p.token_address and a.status='active')) "pendingPoolTokens",
      (select count(*)::integer from registry_priority_pools where chain_id=$1 and selected) "selectedPools",
      (select count(*)::integer from registry_priority_pools p join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.pool_id
        where p.chain_id=$1 and p.selected and m.coverage_complete and m.volume_usd is not null) "completeVolumePools"`, [chainId]),
    readExplorerCoverage(chainId, database)]);
  return { ...result.rows[0], explorer, measuredAt };
}
