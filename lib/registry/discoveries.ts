import { pool } from "@/lib/db";
import { publicReadCache } from "@/lib/public-cache";
import { trustForTokens } from "@/lib/registry/trust";
import type { TrustVerdict } from "@/lib/registry/trust-rules";

export const DISCOVERY_SCOPE = "Tokens first recorded by Fletch, including community contracts, Stock Tokens and bridged assets. Observation time is not a deployment date, Robinhood app listing or evidence of trading. Discovery coverage is incomplete.";
export const DISCOVERY_LIMIT = 50;

interface DiscoveryRecord {
  address: string;
  symbol: string;
  name: string | null;
  source: "contract_metadata" | "asset_list";
  firstSeenAt: Date;
  metadataCheckedAt: Date | null;
}

export interface TokenDiscovery extends Omit<DiscoveryRecord, "firstSeenAt" | "metadataCheckedAt"> {
  firstSeenAt: string;
  metadataCheckedAt: string | null;
  trust: TrustVerdict;
}

export interface TokenDiscoveries {
  chainId: number;
  asOf: string;
  scope: string;
  items: TokenDiscovery[];
}

// Bound each source before merging. Listed addresses use their earliest known
// observation, so later metadata enrichment cannot make an old token look new.
// Timestamps in these tables are UTC without time zone; return explicit instants.
export const TOKEN_DISCOVERIES_SQL = `
  with community as (
    select d.address, d.symbol, d.name, 'contract_metadata' as source,
      d.first_seen_at, d.checked_at as metadata_checked_at
    from dex_tokens d
    where d.chain_id = $1 and not d.hidden and d.bytecode_present = true
      and d.checked_at is not null and d.error is null
      and d.symbol is not null and btrim(d.symbol) <> ''
      and not exists (select 1 from registry_assets a
        where a.chain_id = d.chain_id and a.address = d.address and a.status = 'active')
    order by d.first_seen_at desc, d.address limit $2
  ), listed as (
    select a.address, a.symbol, a.name, 'asset_list' as source,
      least(a.first_seen_at, d.first_seen_at) as first_seen_at, a.metadata_checked_at
    from registry_assets a
    left join dex_tokens d on d.chain_id = a.chain_id and d.address = a.address
    where a.chain_id = $1 and a.status = 'active' and not coalesce(d.hidden, false)
    order by least(a.first_seen_at, d.first_seen_at) desc, a.address limit $2
  )
  select address, symbol, name, source,
    first_seen_at at time zone 'UTC' as "firstSeenAt",
    metadata_checked_at at time zone 'UTC' as "metadataCheckedAt"
  from (select * from community union all select * from listed) discoveries
  order by first_seen_at desc, address limit $2
`;

const cached = publicReadCache<TokenDiscoveries>(15_000, 2);

export async function tokenDiscoveries(chainId: number): Promise<TokenDiscoveries> {
  return cached(String(chainId), async function read() {
    const { rows } = await pool.query<DiscoveryRecord>(TOKEN_DISCOVERIES_SQL, [chainId, DISCOVERY_LIMIT]);
    const verdicts = await trustForTokens(chainId, rows.map((row) => row.address));
    return {
      chainId,
      asOf: new Date().toISOString(),
      scope: DISCOVERY_SCOPE,
      items: rows.map(function serialize(row) {
        const trust = verdicts.get(row.address.toLowerCase());
        if (!trust) throw new Error("A token discovery has no identity verdict.");
        return { ...row, firstSeenAt: row.firstSeenAt.toISOString(), metadataCheckedAt: row.metadataCheckedAt?.toISOString() ?? null, trust };
      }),
    };
  });
}
