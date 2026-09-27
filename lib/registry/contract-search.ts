import { pool } from "@/lib/db";
import { publicReadCache } from "@/lib/public-cache";
import { escapeSearchLike, parseContractQuery, type ContractSearchQuery } from "./contract-search-query";
import { trustForTokens } from "./trust";
import type { TrustLevel } from "./trust-rules";

export interface ContractSearchMatch {
  address: string;
  symbol: string | null;
  name: string | null;
  isin: string | null;
  source: "asset_list" | "contract_metadata" | "lookalike_scan" | "explorer_candidate";
  observedAt: string | null;
  trust: TrustLevel;
  trackedMarket: boolean;
}
export interface ContractSearchPage {
  query: string;
  mode: ContractSearchQuery["mode"];
  similar: boolean;
  items: ContractSearchMatch[];
  total: number;
  page: number;
  pageSize: number;
  checkedAt: string;
}
type SearchRow = Omit<ContractSearchMatch, "trust">;
interface SearchResult { total: number; items: SearchRow[] }

const sources = [
  { table: "registry_assets", symbol: "symbol", name: "name", extra: "coalesce(onchain_symbol,'') || ' ' || coalesce(onchain_name,'') || ' ' || coalesce(isin,'')", isin: "isin", observed: "observed_at", source: "asset_list", condition: "status='active'", quality: 0 },
  { table: "dex_tokens", symbol: "symbol", name: "name", extra: "''", isin: "null::text", observed: "checked_at", source: "contract_metadata", condition: "not hidden and (symbol is not null or name is not null)", quality: 1 },
  { table: "lookalike_tokens", symbol: "symbol", name: "name", extra: "matches_symbol", isin: "null::text", observed: "last_seen_at", source: "lookalike_scan", condition: "true", quality: 2 },
  { table: "registry_explorer_candidates", symbol: "reported_symbol", name: "reported_name", extra: "catalog_symbol", isin: "null::text", observed: "observed_at", source: "explorer_candidate", condition: "true", quality: 3 },
] as const;

// Filter each indexed source before deduplication. One address can have several
// reported labels; its best recorded metadata wins without changing its verdict.
export function contractSearchSql(query: ContractSearchQuery, similar: boolean): { text: string; values: unknown[] } {
  const values: unknown[] = [query.text];
  function bind(value: string): string {
    values.push(value);
    return `$${values.length + 1}::text`;
  }
  const starts = bind(escapeSearchLike(query.text) + "%");
  const prefix = query.mode === "fragment" ? bind(escapeSearchLike(query.prefix) + "%") : "''";
  const suffix = query.mode === "fragment" ? bind("%" + escapeSearchLike(query.suffix)) : "''";
  const terms = query.mode === "text" && !similar ? query.terms.map((value) => bind(query.text.length < 3 ? escapeSearchLike(value) + "%" : "%" + escapeSearchLike(value) + "%")) : [];
  const branches = sources.map(function source(s) {
    let condition: string;
    if (query.mode === "address" || query.mode === "pool") condition = "(address=$2 or address in (select address from pool_tokens))";
    else if (query.mode === "fragment") condition = `address like ${prefix} and address like ${suffix}`;
    else if (query.mode === "isin") condition = s.table === "registry_assets" ? "lower(isin)=$2" : "false";
    else if (similar) condition = `(lower(${s.symbol}) % $2 or lower(${s.name}) %> $2)`;
    else condition = terms.map((term) => `(lower(${s.symbol}) like ${term} or lower(${s.name}) like ${term} or lower(${s.extra}) like ${term})`).join(" and ") || "false";
    return `select address,${s.symbol} as symbol,${s.name} as name,${s.isin} as isin,
      '${s.source}'::text as source,${s.observed}${s.table === "registry_explorer_candidates" ? "" : " at time zone 'UTC'"} as observed_at,${s.quality} as quality,
      case when address=$2 or lower(${s.isin})=$2 then 0 when lower(${s.symbol})=$2 then 1
        when lower(${s.name})=$2 then 2 when lower(${s.symbol}) like ${starts} then 3
        when lower(${s.name}) like ${starts} then 4 else 5 end as relevance,
      ${similar ? `greatest(similarity(lower(${s.symbol}),$2),word_similarity($2,lower(${s.name})))` : "0"} as resemblance
      from ${s.table} where chain_id=$1 and ${s.condition} and (${condition})`;
  });
  // Also resolve recorded addresses whose ERC-20 metadata is still pending.
  if (["address", "fragment", "pool"].includes(query.mode)) branches.push(`select address,symbol,name,null::text,'contract_metadata'::text,
    checked_at at time zone 'UTC',4,0,0 from dex_tokens where chain_id=$1 and not hidden
    and ${query.mode === "fragment" ? `address like ${prefix} and address like ${suffix}` : "(address=$2 or address in (select address from pool_tokens))"}`);
  return { values, text: `with pool_tokens as (
      select unnest(array[currency0,currency1]) as address from dex_pools
      where chain_id=$1 and canonical and (id=$2 or pool_address=$2)
    ), candidates as (${branches.join(" union all ")}), distinct_tokens as (
      select distinct on (c.address) c.* from candidates c
      where not exists(select 1 from dex_tokens hidden where hidden.chain_id=$1 and hidden.address=c.address and hidden.hidden)
      order by c.address,c.quality,c.relevance,c.observed_at desc nulls last
    ), matched as (
      select c.*,p.address is not null as tracked,p.rank as priority_rank
      from distinct_tokens c left join registry_priority_tokens p on p.chain_id=$1 and p.address=c.address
    ), page as (
      select address,symbol,name,isin,source,observed_at as "observedAt",tracked as "trackedMarket"
      from matched order by relevance,resemblance desc nulls last,(source='asset_list') desc,priority_rank asc nulls last,symbol nulls last,address
      limit $${values.length + 2} offset $${values.length + 3}
    ) select (select count(*)::int from matched) as total,coalesce((select json_agg(page) from page),'[]'::json) as items` };
}

const cache = publicReadCache<ContractSearchPage>(15_000, 128);

export async function searchTokenContracts(chainId: number, text: string, page = 1, pageSize = 10): Promise<ContractSearchPage> {
  const query = parseContractQuery(text);
  if (text.length > 2048 || query.text.length > 128 || !Number.isInteger(page) || page < 1 || page > 99_999 || ![10, 20, 50].includes(pageSize)) throw new Error("Invalid contract search query or page.");
  async function read(): Promise<ContractSearchPage> {
    const result: ContractSearchPage = { query: query.text, mode: query.mode, similar: false, items: [], total: 0, page, pageSize, checkedAt: new Date().toISOString() };
    if (!query.text) return result;
    const client = await pool.connect();
    let found: SearchResult;
    try {
      await client.query("begin read only");
      await client.query("set local statement_timeout='2500ms'");
      await client.query("set local pg_trgm.word_similarity_threshold=0.45");
      async function matches(similar: boolean): Promise<SearchResult> {
        const sql = contractSearchSql(query, similar);
        return (await client.query<SearchResult>(sql.text, [chainId, ...sql.values, pageSize, (page - 1) * pageSize])).rows[0];
      }
      found = await matches(false);
      if (found.total === 0 && query.mode === "text" && query.text.length >= 4 && !query.text.startsWith("0x")) {
        found = await matches(true);
        result.similar = found.total > 0;
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally { client.release(); }
    const trust = await trustForTokens(chainId, found.items.map((row) => row.address));
    result.items = found.items.map(function match(row) { return { ...row, trust: trust.get(row.address)?.level ?? "unknown" }; });
    result.total = found.total;
    return result;
  }
  return cache(JSON.stringify([chainId, query, page, pageSize]), read);
}
