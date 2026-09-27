import "server-only";
import { pool } from "@/lib/db";
import { RH_MAINNET_ID } from "@/lib/config";

// Index recorded identities, not arbitrary pasted addresses or unread candidates.
// Metadata errors and operator-hidden contracts stay out of the discovery map.
export const INDEXABLE_TOKENS_SQL = `
  select address from dex_tokens d where chain_id=$1 and not hidden
    and bytecode_present=true and checked_at is not null and error is null
    and symbol is not null and btrim(symbol)<>''
    and name is not null and btrim(name)<>'' and decimals is not null
  union
  select a.address from registry_assets a where a.chain_id=$1 and a.status='active'
    and not exists(select 1 from dex_tokens d where d.chain_id=a.chain_id and d.address=a.address and d.hidden)
`;

export async function tokenSitemapCount(): Promise<number> {
  const result = await pool.query<{ count: string }>(`select count(*) as count from (${INDEXABLE_TOKENS_SQL}) tokens`, [RH_MAINNET_ID]);
  return Number(result.rows[0].count);
}

export async function tokenSitemapPage(page: number, size: number): Promise<string[]> {
  const result = await pool.query<{ address: string }>(`select address from (${INDEXABLE_TOKENS_SQL}) tokens order by address limit $2 offset $3`, [RH_MAINNET_ID, size, page * size]);
  return result.rows.map((row) => row.address);
}
