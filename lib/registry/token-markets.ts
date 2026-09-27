import { publicReadCache } from "@/lib/public-cache";
import { searchTokenContracts } from "./contract-search";
import { matchesContractText, parseContractQuery } from "./contract-search-query";
import { revalidateTokenMarket } from "./token-market-freshness";
import { publicDiagnostic } from "@/lib/public-copy";
import { readStockPairingSummaries } from "./stock-pairings";
import { readAppCatalog, statusForSymbol } from "./app-catalog";
import { pool } from "@/lib/db";
import { trustForTokens } from "./trust";
import type { TrustVerdict } from "./trust-rules";
import type { TokenMetadataObservation, HolderObservation } from "./priority-metadata";
import { observedMetric as metric, tokenSupplyMetric, poolQuoteMetric, capitalizationMetric, expiresAt, observationStatus, METADATA_FRESH_MS, SELECTION_FRESH_MS, SELECTION_POLICY } from "./metric-observation";
import { PRIORITY_STATE_FRESH_MS } from "./priority-model";
import { compareTokenMarkets, tokenMatchesMarketFilters } from "./market-filters";
import type { Metric, MetricObservation, PoolQuoteObservation, TokenAlternative, TokenMarket, TokenMarketPage, TokenMarketQuery } from "./token-markets-types";
export type { Metric, TokenAlternative, TokenMarket, TokenMarketPage, TokenMarketQuery } from "./token-markets-types";

interface TokenRow {
  address: string; asset_id: string | null; asset_type: string | null; asset_source: string | null; asset_observed_at: Date | null; asset_verified_at: Date | null; symbol: string | null; name: string | null;
  dominant_address: string | null; selection_reason: string | null; close_call: boolean | null; group_key: string | null;
  selected_at: Date | null;
  metadata: TokenMetadataObservation | null; holders: HolderObservation | null;
  blockscout_holders: number | null; blockscout_checked_at: Date | null;
}
interface PoolRow {
  chain_id: number; quote_observation: PoolQuoteObservation | null;
  pool_id: string; address: string; selected: boolean; method: string; depth_usd: string | null; price_usd: string | null;
  block_number: string | null; block_hash: string | null; attempted_at: Date | null;
  through_block: string | null; through_hash: string | null; swap_updated_at: Date | null;
  source: string; reason: string | null; observed_at: Date | null; quote_price_source: string | null;
  volume_usd: string | null; swaps: number | null; transactions: number | null; coverage_complete: boolean | null;
  through_at: Date | null; window_start_at: Date | null; volume_valuation: Record<string, unknown> | null;
}

function current(at: string | null, maxAge: number, now: number): boolean {
  const age = at ? now - Date.parse(at) : NaN;
  return Number.isFinite(age) && age >= 0 && age <= maxAge;
}
function positive(value: string | null): number | null {
  const number = value === null ? NaN : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function poolMetric(row: PoolRow | undefined, key: "depth_usd" | "price_usd", now: number): Metric<number> {
  if (!row) return metric<number>(null, null, null, "No supported priority pool observation is available for this measure.");
  const at = row.observed_at?.toISOString() ?? null;
  const value = positive(row[key]);
  const source = `${row.source}. ${row.quote_price_source ?? "Quote conversion unavailable"}. Pool ${row.pool_id}.`;
  let reason = row.reason;
  if (!reason && !current(at, PRIORITY_STATE_FRESH_MS, now)) reason = "The pool observation is older than three minutes or has no valid snapshot time.";
  if (!reason && value === null) reason = "This pool has no usable value at the observed state.";
  const quote = poolQuoteMetric(row.quote_observation, at, row.quote_price_source, now);
  const stateExpiry = expiresAt(at, PRIORITY_STATE_FRESH_MS);
  let expiry = stateExpiry;
  let sourceAt = at;
  if (row.quote_observation) {
    if (quote.observation.expiresAt && stateExpiry) expiry = [stateExpiry, quote.observation.expiresAt].sort()[0];
    else expiry = null;
    if (quote.observation.sourceAt && at) sourceAt = [at, quote.observation.sourceAt].sort()[0];
    if (quote.value === null || quote.observation.status !== "current") reason = quote.reason ?? "The quote-conversion input is unavailable, expired or invalid.";
  }
  const state = metric<number>(null, row.source, at, row.reason, {
    sourceId: `rpc:pool:${row.chain_id}:${row.pool_id}`, blockNumber: row.block_number, blockHash: row.block_hash,
    fetchedAt: row.attempted_at?.toISOString() ?? null, maxAgeMs: PRIORITY_STATE_FRESH_MS, method: row.method,
    readStatus: row.reason ? "failed" : "ok", coverage: { status: row.reason ? "partial" : "complete", scope: "pool_state", windowStartAt: null, windowEndAt: null },
  }, now);
  let readStatus: MetricObservation["readStatus"] = "ok";
  if (row.reason) readStatus = "failed";
  else if (reason) readStatus = "partial";
  else if (value === null) readStatus = "partial";
  return metric(reason ? null : value, source, sourceAt, reason, {
    sourceId: `rpc:pool:${row.chain_id}:${row.pool_id}`, blockNumber: row.block_number, blockHash: row.block_hash,
    parameters: { poolId: row.pool_id },
    fetchedAt: row.attempted_at?.toISOString() ?? null, expiresAt: expiry,
    method: key === "price_usd" ? "pool_spot_price_times_quote_usd" : row.method,
    status: row.quote_observation && quote.observation.status !== "current" ? quote.observation.status : state.observation.status,
    readStatus,
    inputs: [{ name: "poolState", ...state }, { name: "quoteUsd", ...quote }],
    coverage: { status: row.quote_observation && !row.quote_observation.reason ? "complete" : "partial", scope: "selected_pool", windowStartAt: null, windowEndAt: null },
  }, now);
}

function scalarParameters(value: Record<string, unknown> | null | undefined): Record<string, string | number | boolean | null> {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") result[key] = entry;
  }
  return result;
}

function missingCountReason(value: number | null | undefined, label: string): string | null {
  return value == null ? `${label} count unavailable for this completed window.` : null;
}

async function tokenRows(chainId: number, address?: string): Promise<TokenRow[]> {
  const result = await pool.query<TokenRow>(`with tokens as (
    select a.address,a.id as asset_id,a.asset_type,a.source_uri as asset_source,a.observed_at at time zone 'UTC' as asset_observed_at,a.verified_at at time zone 'UTC' as asset_verified_at,a.symbol,a.name from registry_assets a where a.chain_id=$1 and a.status='active' and ($2::text is null or a.address=$2)
    union all select t.address,null,null,null,null,null,t.symbol,t.name from dex_tokens t
      left join registry_priority_tokens p on p.chain_id=t.chain_id and p.address=t.address
      where t.chain_id=$1 and ($2::text is not null and t.address=$2 or $2::text is null and not t.hidden and p.role='community')
        and not exists(select 1 from registry_assets a where a.chain_id=$1 and a.status='active' and a.address=t.address)
    ) select t.*,p.dominant_address,p.selection_reason,p.close_call,p.group_key,p.selected_at,o.metadata,o.holders,
      s.blockscout_holders,s.blockscout_checked_at at time zone 'UTC' as blockscout_checked_at
    from tokens t left join registry_priority_tokens p on p.chain_id=$1 and p.address=t.address
      left join registry_token_observations o on o.chain_id=$1 and o.address=t.address
      left join registry_asset_state s on s.asset_id=t.asset_id order by t.address`, [chainId, address ?? null]);
  return result.rows;
}

async function readInputs(chainId: number, address?: string, knownTrust?: Promise<TrustVerdict>) {
  const rows = await tokenRows(chainId, address);
  if (!rows.length) return null;
  const addresses = rows.map((row) => row.address);
  const groupKeys = rows.flatMap((row) => row.group_key ? [row.group_key] : []);
  const [trusts, observed, counts, alternatives] = await Promise.all([
    knownTrust && address ? knownTrust.then((trust) => new Map([[address, trust]])) : trustForTokens(chainId, addresses),
    pool.query<PoolRow>(`select pp.*,m.volume_usd,m.swaps,m.transactions,m.coverage_complete,m.volume_valuation,s.through_block,s.through_hash,s.updated_at at time zone 'UTC' as swap_updated_at,s.through_at at time zone 'UTC' as through_at,s.window_start_at at time zone 'UTC' as window_start_at
      from registry_priority_pools pp join dex_pools p on p.chain_id=pp.chain_id and p.id=pp.pool_id and p.canonical
        and pp.factory_created_block=p.created_block and pp.factory_created_hash is not distinct from p.created_block_hash
      left join market_pool_swap_metrics m on m.chain_id=p.chain_id and m.pool_id=p.id and m.factory_created_block=p.created_block
        and m.factory_created_hash is not distinct from p.created_block_hash
      left join market_swap_index_state s on s.chain_id=p.chain_id
      where pp.chain_id=$1 and pp.address=any($2) order by pp.selected desc,pp.depth_usd desc nulls last,pp.pool_id`, [chainId, addresses]),
    pool.query<{ address: string; count: number }>(`select address,sum(count)::int as count from (
      select a.address,count(*)::int from registry_assets a join dex_pools p on p.asset_id=a.id and p.chain_id=$1 and p.canonical
        where a.chain_id=$1 and a.address=any($2) group by a.address
      union all select p.token_address as address,count(*)::int from dex_pools p left join registry_assets a on a.id=p.asset_id
        where p.chain_id=$1 and p.canonical and p.token_address=any($2) and a.id is null group by p.token_address
      ) counts group by address`, [chainId, addresses]),
    pool.query<{ group_key: string; address: string; symbol: string | null; name: string | null; selection_reason: string }>(`select p.group_key,p.address,coalesce(a.symbol,t.symbol) as symbol,coalesce(a.name,t.name) as name,p.selection_reason
      from registry_priority_tokens p left join registry_assets a on a.id=p.asset_id
      left join dex_tokens t on t.chain_id=p.chain_id and t.address=p.address
      where p.chain_id=$1 and p.group_key=any($2) order by p.rank,p.address`, [chainId, groupKeys]),
  ]);
  return { rows, trusts, observed, counts, alternatives };
}

// Keep raw database observations shared across filters and pages; derive ages,
// expiry, values and global ordering again on every request.
const cachedInputs = publicReadCache<Awaited<ReturnType<typeof readInputs>>>(10_000, 4);
async function readings(chainId: number, address?: string, knownTrust?: Promise<TrustVerdict>): Promise<TokenMarket[]> {
  const [input, appCatalog] = await Promise.all([
    address ? readInputs(chainId, address, knownTrust) : cachedInputs(String(chainId), () => readInputs(chainId)),
    readAppCatalog(),
  ]);
  if (!input) return [];
  const { rows, trusts, observed, counts, alternatives } = input;
  const now = Date.now();
  return rows.map(function shape(row): TokenMarket {
    const ownPools = observed.rows.filter((entry) => entry.address === row.address);
    function strongest(method: string): PoolRow | undefined {
      const candidates = ownPools.filter((entry) => entry.method === method);
      const usable = candidates.filter((entry) => poolMetric(entry, "depth_usd", now).value !== null);
      return (usable.length ? usable : candidates).sort((a, b) => (positive(b.depth_usd) ?? -1) - (positive(a.depth_usd) ?? -1))[0];
    }
    const v3 = strongest("v3_quote_holdings");
    const v4 = strongest("v4_bounded_one_percent");
    const selected = ownPools.find((entry) => entry.selected);
    let best = selected;
    if (!best) {
      if (v3 && (positive(v3.depth_usd) ?? 0) >= 10_000) best = v3;
      else best = v4 ?? v3;
    }
    const price = poolMetric(best, "price_usd", now);
    const metadata = row.metadata;
    const metadataAt = metadata?.asOf ?? null;
    const metadataCurrent = current(metadataAt, METADATA_FRESH_MS, now);
    let metadataReason = metadata?.metadataError ?? metadata?.reason ?? null;
    if (!metadata) metadataReason = "Priority ERC-20 metadata has not been read yet.";
    else if (!metadataCurrent) metadataReason = "ERC-20 metadata is older than 24 hours.";
    let metadataCoverage: MetricObservation["coverage"]["status"] = "unknown";
    if (metadata) metadataCoverage = metadata.reason ? "partial" : "complete";
    const metadataFacts: Partial<MetricObservation> = {
      sourceId: `rpc:erc20:${chainId}:${row.address}`, blockNumber: metadata?.blockNumber ?? null,
      blockHash: metadata?.blockHash ?? null, fetchedAt: metadata?.fetchedAt ?? null,
      coverage: { status: metadataCoverage, scope: "token", windowStartAt: null, windowEndAt: null },
    };
    const decimals = metric(metadata?.decimals ?? null, metadata?.source ?? null, metadataAt,
      metadataReason ?? (metadata?.decimals == null ? "The token decimals call failed." : null),
      { ...metadataFacts, method: "erc20_decimals", maxAgeMs: METADATA_FRESH_MS, readStatus: metadata?.metadataError ? "failed" : undefined }, now);
    const totalSupply = tokenSupplyMetric(metadata, "supply", chainId, row.address, now);
    const burned = tokenSupplyMetric(metadata, "burn", chainId, row.address, now);
    const marketCap = capitalizationMetric(decimals, totalSupply, burned, price, now);
    const at = best?.through_at?.toISOString() ?? null;
    const complete = best?.coverage_complete === true && current(at, 120_000, now);
    const valuation = best?.volume_valuation;
    const quoteTimes = valuation && (valuation.oracleUpdatedFrom || valuation.oracleUpdatedThrough)
      ? ` Oracle observations ${String(valuation.oracleUpdatedFrom ?? "unknown")} through ${String(valuation.oracleUpdatedThrough ?? "unknown")}; allowed oracle age ${String(valuation.maxOracleAgeSeconds ?? "unknown")} seconds.` : "";
    const volumeSource = best ? `Selected pool ${best.pool_id}. ${typeof valuation?.source === "string" ? valuation.source : "Indexed canonical Swap events"}${quoteTimes}` : null;
    let volumeReason = typeof valuation?.reason === "string" ? valuation.reason : null;
    if (!best) volumeReason = "No selected pool is available.";
    else if (!complete) volumeReason = "The selected pool does not have a complete, current 24-hour swap window.";
    const volumeValue = complete ? positive(best?.volume_usd ?? null) : null;
    let holders = metric<number>(null, publicDiagnostic(row.holders?.source ?? "Complete holder snapshot"), row.holders?.asOf ?? null,
      publicDiagnostic(row.holders?.reason ?? "No complete current holder snapshot. Explorer access or a completed targeted transfer-history scan is required."),
      { sourceId: row.holders?.blockNumber ? `rpc:holders:${chainId}:${row.address}` : `blockscout:holders:${chainId}:${row.address}`,
        method: row.holders?.blockNumber ? "transfer_history_positive_balances_supply_reconciled" : "explorer_holder_count", sourceAt: row.holders?.blockNumber ? row.holders.asOf : null,
        blockNumber: row.holders?.blockNumber ?? null, blockHash: row.holders?.blockHash ?? null,
        fetchedAt: row.holders?.blockNumber ? null : row.holders?.asOf ?? null }, now);
    if (row.holders?.value !== null && row.holders?.value !== undefined && current(row.holders.asOf, 24 * 60 * 60_000, now)) {
      holders = metric(row.holders.value, publicDiagnostic(row.holders.source), row.holders.asOf, row.holders.reason ? publicDiagnostic(row.holders.reason) : null,
        { ...holders.observation, coverage: { status: "complete", scope: "token_holders", windowStartAt: null, windowEndAt: null }, readStatus: "ok" }, now);
    } else if (row.blockscout_holders !== null && current(row.blockscout_checked_at?.toISOString() ?? null, 6 * 60 * 60_000, now)) {
      holders = metric(row.blockscout_holders, "Chain explorer indexed holder count", row.blockscout_checked_at!.toISOString(), null,
        { sourceId: "blockscout:indexed_holders", sourceAt: null, fetchedAt: row.blockscout_checked_at!.toISOString(),
          maxAgeMs: 6 * 60 * 60_000, method: "explorer_holder_count", readStatus: "ok" }, now);
    }
    const selectionAt = row.selected_at?.toISOString() ?? null;
    const selectionExpiry = expiresAt(selectionAt, SELECTION_FRESH_MS);
    const selection = { selectedAt: selectionAt, expiresAt: selectionExpiry, policy: SELECTION_POLICY,
      status: observationStatus(selectionAt, selectionExpiry, now) };
    let swapReadStatus: MetricObservation["readStatus"] = "unread";
    let swapCoverage: MetricObservation["coverage"]["status"] = "unknown";
    if (best) {
      swapReadStatus = complete ? "ok" : "partial";
      swapCoverage = best.coverage_complete ? "complete" : "partial";
    }
    const swapFacts: Partial<MetricObservation> & { maxAgeMs: number } = {
      sourceId: best ? `rpc:canonical_swaps:${chainId}:${best.pool_id}` : null,
      blockNumber: best?.through_block ?? null, blockHash: best?.through_hash ?? null,
      fetchedAt: best?.swap_updated_at?.toISOString() ?? null, maxAgeMs: 120_000,
      coverage: { status: swapCoverage, scope: "selected_pool_24h",
        windowStartAt: best?.window_start_at?.toISOString() ?? null, windowEndAt: at },
      readStatus: swapReadStatus,
    };
    const related: TokenAlternative[] = alternatives.rows.filter((entry) => entry.group_key === row.group_key && entry.address !== row.address)
      .map((entry) => ({ address: entry.address, symbol: entry.symbol, name: entry.name, reason: entry.selection_reason }));
    const symbol = row.asset_id ? row.symbol : metadata?.symbol ?? row.symbol;
    return { chainId, robinhoodApp: statusForSymbol(appCatalog, symbol, row.asset_type),
      ...(row.asset_type === "stock_token" ? { stockToken: { source: row.asset_source, address: row.address,
        observedAt: row.asset_observed_at?.toISOString() ?? null, ageSeconds: row.asset_observed_at ? Math.floor((now - row.asset_observed_at.getTime()) / 1000) : null,
        verifiedAt: row.asset_verified_at?.toISOString() ?? null, verified: trusts.get(row.address)?.level === "verified" } } : {}), address: row.address, assetId: row.asset_id, symbol,
      name: row.asset_id ? row.name : metadata?.name ?? row.name, trust: trusts.get(row.address)?.level ?? "unknown",
      dominantAddress: selection.status === "current" ? row.dominant_address : null, selection, selectionReason: row.selection_reason ?? "This explicit address is outside the current priority comparison set.",
      closeCall: row.close_call ?? false, alternatives: related, bestPoolId: best?.pool_id ?? null,
      poolCount: counts.rows.find((entry) => entry.address === row.address)?.count ?? 0,
      decimals, totalSupplyRaw: totalSupply, burnedRaw: burned, metadataReason, volumeScope: "selected_pool",
      priceUsd: price, marketCapUsd: marketCap,
      volumeUsd24h: metric(volumeValue, volumeSource, at, volumeReason ?? (volumeValue === null ? "The quote currency has no supported historical valuation for this window." : null),
        { ...swapFacts, method: typeof valuation?.method === "string" ? valuation.method : "unknown",
          parameters: scalarParameters(valuation) }, now),
      swaps24h: metric(complete ? best?.swaps ?? null : null, best ? `Swap events in selected pool ${best.pool_id}` : null, at,
        !complete ? volumeReason : missingCountReason(best?.swaps, "Swap"), { ...swapFacts, method: "count_canonical_swaps" }, now),
      transactions24h: metric(complete ? best?.transactions ?? null : null, best ? `Distinct transactions in selected pool ${best.pool_id}` : null, at,
        !complete ? volumeReason : missingCountReason(best?.transactions, "Transaction"), { ...swapFacts, method: "count_distinct_canonical_swap_transactions" }, now),
      holders, v3QuoteHoldingsUsd: poolMetric(v3, "depth_usd", now), v4OnePercentDepthUsd: poolMetric(v4, "depth_usd", now) };
  });
}

async function attachPairings(chainId: number, rows: TokenMarket[]): Promise<TokenMarket[]> {
  const pairings = await readStockPairingSummaries(chainId, rows.map((row) => row.address));
  return rows.map(function attach(row): TokenMarket {
    const pairing = pairings.get(row.address);
    if (!pairing) return { ...row, stockPairings: [] };
    return { ...row, stockPairings: pairing.items, stockPairingSummary: pairing.summary };
  });
}

export async function readTokenMarkets(chainId: number, query: TokenMarketQuery = {}): Promise<TokenMarketPage> {
  const pageSize = query.pageSize === 50 ? 50 : 25;
  const page = Number.isInteger(query.page) && query.page! > 0 ? query.page! : 1;
  const sort = query.sort ?? "volume";
  const search = parseContractQuery(query.query ?? "");
  const exactAddress = search.mode === "address" ? search.text : undefined;
  let contractSearchError: string | undefined;
  const [marketRows, contractSearch] = await Promise.all([
    readings(chainId, exactAddress),
    search.text ? searchTokenContracts(chainId, search.text, query.searchPage).catch(function searchUnavailable() {
      contractSearchError = "Contract search is temporarily unavailable. Refresh to try again. Tracked market readings are still shown below.";
      return undefined;
    }) : undefined,
  ]);
  const rows = marketRows.filter((row) => tokenMatchesMarketFilters(row, query));
  rows.sort((a, b) => compareTokenMarkets(a, b, sort, query.order));
  const catalog = await readAppCatalog();
  const symbols = [...new Set(catalog.pairs.map((pair) => pair.asset_currency.code))].filter((symbol) => !query.query || catalog.pairs.some((pair) => pair.asset_currency.code === symbol && matchesContractText([symbol, pair.asset_currency.name], query.query!)));
  const matches = symbols.length ? await pool.query<{ symbol: string; address: string }>(`select upper(symbol) as symbol,address from dex_tokens where chain_id=$1 and not hidden and upper(symbol)=any($2) union select upper(symbol),address from registry_assets where chain_id=$1 and status='active' and upper(symbol)=any($2)`, [chainId, symbols]) : { rows: [] };
  const catalogMatches = symbols.map((symbol) => ({ symbol, name: catalog.pairs.find((pair) => pair.asset_currency.code === symbol)!.asset_currency.name, status: statusForSymbol(catalog, symbol), addresses: matches.rows.filter((row) => row.symbol === symbol).map((row) => row.address) }));
  return { contractSearch, contractSearchError, catalog: { ...catalog, pairs: [] }, catalogMatches, items: (await attachPairings(chainId, rows.slice((page - 1) * pageSize, page * pageSize))).map((row) => revalidateTokenMarket(row)), total: rows.length, page, pageSize, asOf: new Date().toISOString(), sort, order: query.order ?? (sort === "name" ? "asc" : "desc") };
}

export async function readTokenMarket(chainId: number, address: string, knownTrust?: Promise<TrustVerdict>): Promise<TokenMarket | null> {
  if (!/^0x[0-9a-f]{40}$/i.test(address)) return null;
  return (await attachPairings(chainId, await readings(chainId, address.toLowerCase(), knownTrust)))[0] ?? null;
}
