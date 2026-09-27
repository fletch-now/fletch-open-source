import type { Pool } from "pg";

export interface ExplorerScoutingCoverage {
  searchesCompleted: number;
  searchesDue: number;
  candidateContracts: number;
  pendingContractChecks: number;
  lastSearchAt: string | null;
  provider: { observedAt: string; httpStatus: number; creditsAvailable: boolean | null; requestsPerSecond: number | null } | null;
}

export async function readExplorerCoverage(chainId: number, database: Pick<Pool, "query">): Promise<ExplorerScoutingCoverage> {
  const result = await database.query<ExplorerScoutingCoverage>(`with catalog as (
      select symbol,max(observed_at) catalog_at from robinhood_app_pairs where present group by symbol
    ), searches as (
      select c.symbol,s.completed_at,s.observed_at,s.catalog_at=c.catalog_at and s.next_page is null
        and s.error is null and s.completed_at>now()-interval '6 hours' current
      from catalog c left join registry_explorer_searches s on s.chain_id=$1 and s.symbol=c.symbol
    ) select
      (select count(*)::int from searches where current) "searchesCompleted",
      (select count(*)::int from searches where not coalesce(current,false)) "searchesDue",
      (select count(*)::int from registry_explorer_candidates where chain_id=$1) "candidateContracts",
      (select count(*)::int from registry_explorer_candidates c left join registry_token_observations o on o.chain_id=c.chain_id and o.address=c.address
        where c.chain_id=$1 and not exists(select 1 from registry_assets a where a.chain_id=c.chain_id and a.address=c.address and a.status='active')
          and (o.metadata is null or o.metadata->>'reason' is not null or o.metadata->>'asOf' is null
            or (o.metadata->>'asOf')::timestamptz<now()-interval '1 day' or (o.metadata->>'asOf')::timestamptz>now())) "pendingContractChecks",
      (select to_char(max(observed_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') from searches) "lastSearchAt",
      (select jsonb_build_object('observedAt',value::jsonb->'observedAt','httpStatus',value::jsonb->'httpStatus',
        'creditsAvailable',(value::jsonb->>'creditsRemaining')::numeric>0,'requestsPerSecond',value::jsonb->'requestsPerSecond')
        from app_settings where key='registry.blockscout') provider`, [chainId]);
  return result.rows[0];
}
