import { publicReadCache } from "@/lib/public-cache";
import { pool } from "@/lib/db";
import { publicDiagnostic } from "@/lib/public-copy";
import { METADATA_FRESH_MS } from "./metric-observation";
import { trustForTokens, verifiedAssetIndex } from "./trust";

export const STOCK_PAIRING_RANKING = "latest_recorded_swap_then_resolved_metadata_then_creation_block_then_pool_id" as const;
export const STOCK_PAIRING_SOURCE = "Recorded canonical factory pools and token contract metadata";

export interface StockPairing {
  id: string;
  poolId: string;
  venue: string;
  stockSymbol: string;
  stockAddress: string;
  canonicalAddress: string;
  stockVerdict: "canonical" | "lookalike" | "unconfirmed";
  communityAddress: string;
  communitySymbol: string | null;
  communityName: string | null;
  metadataStatus: "current" | "stale" | "pending" | "failed";
  metadataAgeSeconds: number | null;
  metadataError: string | null;
  observedAt: string | null;
  lastSwapAt: string | null;
  createdBlock: string;
}

export interface StockPairingSummary {
  totalPools: number;
  counterparties: number;
  resolvedCounterparties: number;
  pendingCounterparties: number;
  observedSwapPools: number;
  latestSwapAt: string | null;
  ranking: typeof STOCK_PAIRING_RANKING;
  source: string;
  asOf: string;
  url: string;
}

export interface StockPairingPage {
  chainId: number;
  address: string | null;
  items: StockPairing[];
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  summary: StockPairingSummary;
}

export interface StockPairingQuery { address?: string; limit: number; offset: number }
interface PairingRow {
  id: string; venue: string; stock: string; community: string; symbol: string; canonical_address: string;
  community_symbol: string | null; community_name: string | null; metadata_error: string | null;
  observed_at: string | null; last_swap_at: string | null; created_block: string; stock_verdict?: StockPairing["stockVerdict"];
}
interface AggregateRow {
  request_address: string | null; total: number; pool_count: number; counterparties: number; resolved: number; pending: number;
  observed_swap_pools: number; latest_swap_at: string | null; items: PairingRow[];
}

export function stockPairingQuery(params: URLSearchParams): StockPairingQuery {
  for (const key of params.keys()) {
    if (!["address", "limit", "offset"].includes(key) || params.getAll(key).length !== 1) throw new Error(`Unknown or repeated query parameter: ${key}`);
  }
  const address = params.get("address")?.toLowerCase();
  if (address !== undefined && !/^0x[0-9a-f]{40}$/.test(address)) throw new Error("address must be a 20-byte contract address");
  function integer(key: string, fallback: number, min: number, max: number): number {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
    return value;
  }
  return { address, limit: integer("limit", 50, 1, 100), offset: integer("offset", 0, 0, 1_000_000) };
}

export function pairingFromRow(row: PairingRow, now: number): StockPairing {
  const observedAt = row.observed_at ? new Date(row.observed_at).toISOString() : null;
  const age = observedAt ? now - Date.parse(observedAt) : null;
  let metadataStatus: StockPairing["metadataStatus"] = "pending";
  if (row.metadata_error) metadataStatus = "failed";
  else if (row.community_symbol && age !== null) metadataStatus = age >= 0 && age <= METADATA_FRESH_MS ? "current" : "stale";
  return { id: `${row.id}:${row.stock}`, poolId: row.id, venue: row.venue, stockSymbol: row.symbol,
    stockAddress: row.stock, canonicalAddress: row.canonical_address,
    stockVerdict: row.stock === row.canonical_address ? "canonical" : row.stock_verdict ?? "unconfirmed",
    communityAddress: row.community, communitySymbol: row.community_symbol, communityName: row.community_name,
    metadataStatus, metadataAgeSeconds: age === null ? null : Math.floor(age / 1000), metadataError: row.metadata_error ? publicDiagnostic(row.metadata_error) : null,
    observedAt, lastSwapAt: row.last_swap_at ? new Date(row.last_swap_at).toISOString() : null, createdBlock: row.created_block };
}

async function queryPairings(chainId: number, addresses: string[] | null, limit: number, offset: number, grouped: boolean): Promise<AggregateRow[]> {
  const verified = (await verifiedAssetIndex(chainId)).filter((asset) => asset.assetType === "stock_token");
  if (!verified.length || addresses?.length === 0) return [];
  // The requested addresses and their same-ticker stock contracts enter the
  // currency indexes before pool expansion. A token page never scans all pools.
  const client = await pool.connect();
  let rows: AggregateRow[];
  try {
    // PostgreSQL overestimates the same-ticker expansion and spends over a second
    // compiling this short read. Keep JIT disabled only for this transaction.
    await client.query("BEGIN READ ONLY; SET LOCAL jit = off");
    const result = await client.query<AggregateRow>(`
    with verified as (
      select * from unnest($2::text[],$3::text[]) as v(address,symbol)
    ), stock as materialized (
      select address as stock,address as canonical_address,symbol from verified
      union select t.address,v.address,v.symbol from dex_tokens t join verified v on upper(t.symbol)=upper(v.symbol)
        where t.chain_id=$1 and not t.hidden and not exists(select 1 from verified x where x.address=t.address)
    ), requested as (select unnest(coalesce($4::text[],array[null::text])) as request_address),
    candidate_addresses as (
      select r.request_address,r.request_address as address from requested r where r.request_address is not null
      union select r.request_address,s.stock from requested r join stock s on r.request_address is null or s.canonical_address=r.request_address
    ), candidates as materialized (
      select c.request_address,p.* from candidate_addresses c join lateral (
        select id,venue,currency0,currency1,created_block,last_swap_at from dex_pools
        where chain_id=$1 and currency0=c.address and canonical offset 0
      ) p on true
      union select c.request_address,p.* from candidate_addresses c join lateral (
        select id,venue,currency0,currency1,created_block,last_swap_at from dex_pools
        where chain_id=$1 and currency1=c.address and canonical offset 0
      ) p on true
    ), sides as (
      select p.*,s.stock,s.symbol,s.canonical_address,p.currency1 as community from candidates p join stock s on s.stock=p.currency0
      union all select p.*,s.stock,s.symbol,s.canonical_address,p.currency0 as community from candidates p join stock s on s.stock=p.currency1 where p.currency0<>p.currency1
    ), facts as materialized (
      select p.request_address,p.id,p.venue,p.stock,p.symbol,p.canonical_address,p.community,p.created_block::text,
        coalesce(nullif(t.symbol,''),nullif(o.metadata->>'symbol','')) as community_symbol,
        coalesce(nullif(t.name,''),nullif(o.metadata->>'name','')) as community_name,
        coalesce(t.error,o.metadata->>'metadataError',o.metadata->>'reason') as metadata_error,
        coalesce(t.checked_at at time zone 'UTC',(o.metadata->>'asOf')::timestamptz) as observed_at,
        p.last_swap_at at time zone 'UTC' as last_swap_at
      from sides p left join dex_tokens t on t.chain_id=$1 and t.address=p.community
        left join registry_token_observations o on o.chain_id=$1 and o.address=p.community
      where (p.request_address is null or p.stock=p.request_address or p.community=p.request_address or p.canonical_address=p.request_address)
        and not coalesce(t.hidden,false) and not exists(select 1 from registry_assets a where a.chain_id=$1 and a.address=p.community and a.status='active')
    ), ranked as (
      select f.*,row_number() over(partition by request_address,stock,community order by last_swap_at desc nulls last,
        (community_symbol is not null) desc,created_block::numeric desc,id) as counterparty_rank from facts f
    ), page_candidates as (
      select f.*,row_number() over(partition by request_address order by last_swap_at desc nulls last,
        (community_symbol is not null) desc,created_block::numeric desc,id,stock) as page_rank
      from ranked f where not $7::boolean or counterparty_rank=1
    ), pages as (
      select request_address,jsonb_agg(row_to_json(p) order by page_rank) as items
      from page_candidates p where page_rank>$6 and page_rank<=$6+$5 group by request_address
    ), totals as (
      select request_address,count(distinct id)::int pool_count,count(*)::int total,
        count(distinct community)::int counterparties,
        count(distinct community) filter(where community_symbol is not null)::int resolved,
        count(distinct community) filter(where community_symbol is null)::int pending,
        count(distinct id) filter(where last_swap_at is not null)::int observed_swap_pools,
        max(last_swap_at) latest_swap_at from facts group by request_address
    ) select r.request_address,coalesce(t.pool_count,0)::int pool_count,coalesce(t.total,0)::int total,
      coalesce(t.counterparties,0)::int counterparties,coalesce(t.resolved,0)::int resolved,
      coalesce(t.pending,0)::int pending,coalesce(t.observed_swap_pools,0)::int observed_swap_pools,t.latest_swap_at,
      coalesce(page.items,'[]'::jsonb) as items from requested r
      left join totals t on t.request_address is not distinct from r.request_address
      left join pages page on page.request_address is not distinct from r.request_address`,
    [chainId, verified.map((asset) => asset.address), verified.map((asset) => asset.symbol), addresses, limit, offset, grouped]);
    await client.query("COMMIT");
    rows = result.rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const alternatives = rows.flatMap((row) => row.items).filter((item) => item.stock !== item.canonical_address);
  if (alternatives.length) {
    const verdicts = await trustForTokens(chainId, alternatives.map((item) => item.stock));
    for (const item of alternatives) item.stock_verdict = verdicts.get(item.stock)?.level === "lookalike" ? "lookalike" : "unconfirmed";
  }
  return rows;
}

function summary(chainId: number, address: string | null, row: AggregateRow | undefined, now: number): StockPairingSummary {
  return { totalPools: row?.pool_count ?? 0, counterparties: row?.counterparties ?? 0, resolvedCounterparties: row?.resolved ?? 0,
    pendingCounterparties: row?.pending ?? 0, observedSwapPools: row?.observed_swap_pools ?? 0,
    latestSwapAt: row?.latest_swap_at ? new Date(row.latest_swap_at).toISOString() : null,
    ranking: STOCK_PAIRING_RANKING, source: STOCK_PAIRING_SOURCE, asOf: new Date(now).toISOString(),
    url: `/api/v1/chains/${chainId}/stock-pairings${address ? `?address=${address}` : ""}` };
}

const cachedSummaryRows = publicReadCache<{ rows: AggregateRow[]; measuredAt: number }>(10_000, 32);

export async function readStockPairingSummaries(chainId: number, addresses: string[]): Promise<Map<string, { items: StockPairing[]; summary: StockPairingSummary }>> {
  const requested = [...new Set(addresses.map((address) => address.toLowerCase()))].sort();
  const { rows, measuredAt } = await cachedSummaryRows(`${chainId}:${requested.join(",")}`, async () => {
    const measuredAt = Date.now();
    return { rows: await queryPairings(chainId, requested, 3, 0, true), measuredAt };
  });
  const now = Date.now();
  return new Map(rows.filter((row) => row.request_address !== null).map((row) => [row.request_address!, {
    items: row.items.map((item) => pairingFromRow(item, now)), summary: summary(chainId, row.request_address, row, measuredAt),
  }]));
}

export async function readStockPairingPage(chainId: number, query: StockPairingQuery): Promise<StockPairingPage> {
  const address = query.address?.toLowerCase() ?? null;
  const [row] = await queryPairings(chainId, address ? [address] : null, query.limit, query.offset, false);
  const now = Date.now();
  const items = (row?.items ?? []).map((item) => pairingFromRow(item, now));
  const total = row?.total ?? 0;
  const next = query.offset + items.length;
  return { chainId, address, items, total, limit: query.limit, offset: query.offset, nextOffset: next < total ? next : null,
    summary: summary(chainId, address, row, now) };
}

export async function readStockPairings(chainId: number, address?: string): Promise<StockPairing[]> {
  return (await readStockPairingPage(chainId, { address, limit: 100, offset: 0 })).items;
}
