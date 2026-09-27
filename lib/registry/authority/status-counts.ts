import type { Pool } from "pg";
import { pool } from "@/lib/db";

// The Status summary reads the same bounded projection as token markets.
// Counting the entire historical event ledger made every cold status request
// scan millions of rows as the index grew.
export async function readCurrentSwapFigure(chainId: number, database: Pick<Pool, "query"> = pool, now = new Date()): Promise<{ newestAt: Date | null; count: number }> {
  const result = await database.query<{ newest_at: Date | null; count: string }>(`
    select max(s.through_at) at time zone 'UTC' newest_at,coalesce(sum(m.swaps),0)::text count
    from registry_priority_pools pp
      join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
        and pp.factory_created_block=p.created_block
        and pp.factory_created_hash is not distinct from p.created_block_hash
      join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id
        and m.factory_created_block=p.created_block
        and m.factory_created_hash is not distinct from p.created_block_hash
      join market_swap_index_state s on s.chain_id=p.chain_id
    where pp.chain_id=$1 and pp.selected and m.coverage_complete and m.swaps is not null
      and s.through_at between $2::timestamptz-interval '2 minutes' and $2::timestamptz`, [chainId, now.toISOString()]);
  return { newestAt: result.rows[0].newest_at, count: Number(result.rows[0].count) };
}
