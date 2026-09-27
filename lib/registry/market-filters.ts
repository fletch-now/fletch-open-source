import type { TokenMarket, TokenMarketQuery } from "./token-markets-types";
import { matchesContractText } from "./contract-search-query";

// The URL parser, menus, OpenAPI and JSON discovery response share this catalog.
export const MARKET_FILTERS = {
  kind: { label: "Tokens", default: "all", options: [
    { value: "all", label: "All tokens", description: "Issuer listings and priority community contracts." },
    { value: "listed", label: "Listed", description: "Contracts in the issuer list, including pending checks." },
    { value: "community", label: "Community", description: "Priority contracts outside the issuer list. Check their trust badge." },
  ] },
  trust: { label: "Trust", default: "all", options: [
    { value: "all", label: "All verdicts", description: "Keep every recorded identity verdict." },
    { value: "verified", label: "Verified", description: "Issuer listing and matching contract checks." },
    { value: "listed", label: "Listed", description: "Issuer listing with checks still incomplete." },
    { value: "community", label: "Community", description: "Resolved metadata with no recorded issuer-name collision." },
    { value: "lookalike", label: "Lookalike", description: "Name or symbol collides with a verified asset." },
    { value: "unknown", label: "Unknown", description: "Identity calls have not resolved this contract." },
  ] },
  sort: { label: "Sort", default: "volume", options: [
    { value: "price", label: "Price", description: "Current selected-pool price in USD." },
    { value: "pools", label: "Pools", description: "Recorded canonical pool count." },
    { value: "volume", label: "24h volume", description: "Selected-pool USD volume, highest first." },
    { value: "swaps", label: "24h swaps", description: "Selected-pool swap events, highest first." },
    { value: "market_cap", label: "Market cap estimate", description: "Outstanding supply estimate times current price, highest first." },
    { value: "v3_depth", label: "V3 quote holdings", description: "Observed quote-side holdings in dollars, highest first." },
    { value: "v4_depth", label: "V4 1% depth", description: "Bounded quote input for a 1% move, highest first." },
    { value: "name", label: "Name", description: "Alphabetical name, then contract address." },
  ] },
  order: { label: "Direction", default: "desc", options: [
    { value: "desc", label: "Highest first", description: "Descending values; unavailable readings remain last. Numeric sorts default to descending." },
    { value: "asc", label: "Lowest first", description: "Ascending values; unavailable readings remain last. Name sorting defaults to ascending when order is omitted." },
  ] },
  activity: { label: "Activity", default: "all", options: [
    { value: "all", label: "Any activity", description: "Include incomplete and unavailable swap windows." },
    { value: "traded", label: "Traded in 24h", description: "At least one swap in a complete current 24-hour window." },
    { value: "busy", label: "100+ swaps in 24h", description: "At least 100 swaps in a complete current window." },
    { value: "quiet", label: "Zero swaps in 24h", description: "A complete current window with exactly zero swaps." },
  ] },
  data: { label: "Readings", default: "all", options: [
    { value: "all", label: "All readings", description: "Keep unavailable measures with their reason." },
    { value: "priced", label: "Current price", description: "Usable selected-pool price with pool state and quote conversion inside their three-minute freshness policy." },
    { value: "volume", label: "Complete 24h volume", description: "Valued 24-hour window counted through the last two minutes." },
    { value: "complete", label: "Price, volume and cap", description: "All three measures have usable current inputs." },
  ] },
  depth: { label: "Depth", default: "all", options: [
    { value: "all", label: "Any depth", description: "Keep both pool types and unavailable observations." },
    { value: "v3_10k", label: "V3 holdings $10k+", description: "At least $10,000 of current quote-side holdings." },
    { value: "v3_100k", label: "V3 holdings $100k+", description: "At least $100,000 of current quote-side holdings." },
    { value: "v4_1k", label: "V4 1% depth $1k+", description: "At least $1,000 of bounded quote input for a 1% move." },
    { value: "v4_10k", label: "V4 1% depth $10k+", description: "At least $10,000 of bounded quote input for a 1% move." },
  ] },
  identity: { label: "Identity", default: "all", options: [
    { value: "all", label: "All contracts", description: "One row per recorded priority contract." },
    { value: "dominant", label: "Leading community contracts", description: "Community contracts selected by the recorded economic comparison." },
    { value: "same_name", label: "Same-name alternatives", description: "Contracts with alternatives in the recorded comparison set." },
    { value: "close_call", label: "Close comparisons", description: "The dominance comparison recorded a close call." },
  ] },
} as const;

export type MarketFilterKey = keyof typeof MARKET_FILTERS;
export type MarketFilterValue<K extends MarketFilterKey> = (typeof MARKET_FILTERS)[K]["options"][number]["value"];
export type MarketSort = MarketFilterValue<"sort">;
export const MARKET_FILTER_KEYS = Object.keys(MARKET_FILTERS) as MarketFilterKey[];

export const MARKET_PRESETS = [
  { label: "Most traded", query: { sort: "volume", activity: "traded" } },
  { label: "Community activity", query: { kind: "community", activity: "traded", sort: "volume" } },
  { label: "100+ daily swaps", query: { activity: "busy", sort: "swaps" } },
  { label: "Current market data", query: { data: "complete", sort: "volume" } },
  { label: "Compare names", query: { identity: "same_name", sort: "volume" } },
] as const;

export const MARKET_FILTER_CONTRACT = {
  version: 1,
  scope: "Tracked token markets and requested contract readings. Activity and volume cover each token's selected pool. Filters apply to market items; contractSearch has separate results and pagination.",
  combination: "All supplied filters must match. Missing or invalidated measures never satisfy a numeric filter, including a zero threshold.",
  ordering: "All matching rows are sorted before pagination. Numeric sorts default to descending; name defaults to ascending. Explicit order=asc or desc overrides direction. Unavailable values stay last in both directions. Numeric ties use contract address; name ties use address. Depth measures remain separate.",
  filters: MARKET_FILTERS,
  minVolumeUsd: { label: "Minimum 24h volume", minimum: 0, maximum: 1_000_000_000_000, description: "Inclusive selected-pool USD volume threshold. Requires a complete current valued window." },
  presets: MARKET_PRESETS,
};

function atLeast(value: number | null, minimum: number): boolean {
  return value !== null && Number.isFinite(value) && value >= minimum;
}

export function tokenMatchesMarketFilters(row: TokenMarket, query: TokenMarketQuery): boolean {
  if (query.query && !matchesContractText([row.address, row.symbol, row.name], query.query)) return false;
  if (query.kind === "listed" && row.assetId === null) return false;
  if (query.kind === "community" && row.assetId !== null) return false;
  if (query.trust && row.trust !== query.trust) return false;
  if (query.activity === "traded" && !atLeast(row.swaps24h.value, 1)) return false;
  if (query.activity === "busy" && !atLeast(row.swaps24h.value, 100)) return false;
  if (query.activity === "quiet" && row.swaps24h.value !== 0) return false;
  if ((query.data === "priced" || query.data === "complete") && !atLeast(row.priceUsd.value, 0)) return false;
  if ((query.data === "volume" || query.data === "complete") && !atLeast(row.volumeUsd24h.value, 0)) return false;
  if (query.data === "complete" && !atLeast(row.marketCapUsd.value, 0)) return false;
  if (query.minVolumeUsd !== undefined && !atLeast(row.volumeUsd24h.value, query.minVolumeUsd)) return false;
  if (query.depth === "v3_10k" && !atLeast(row.v3QuoteHoldingsUsd.value, 10_000)) return false;
  if (query.depth === "v3_100k" && !atLeast(row.v3QuoteHoldingsUsd.value, 100_000)) return false;
  if (query.depth === "v4_1k" && !atLeast(row.v4OnePercentDepthUsd.value, 1_000)) return false;
  if (query.depth === "v4_10k" && !atLeast(row.v4OnePercentDepthUsd.value, 10_000)) return false;
  if (query.identity === "dominant" && (row.assetId !== null || row.dominantAddress !== row.address)) return false;
  if (query.identity === "same_name" && row.alternatives.length === 0) return false;
  if (query.identity === "close_call" && !row.closeCall) return false;
  return true;
}

export function marketSortValue(row: TokenMarket, sort: MarketSort): number | null {
  switch (sort) {
    case "price": return row.priceUsd.value;
    case "pools": return row.poolCount;
    case "volume": return row.volumeUsd24h.value;
    case "swaps": return row.swaps24h.value;
    case "market_cap": return row.marketCapUsd.value;
    case "v3_depth": return row.v3QuoteHoldingsUsd.value;
    case "v4_depth": return row.v4OnePercentDepthUsd.value;
    case "name": return null;
  }
}

export function compareTokenMarkets(a: TokenMarket, b: TokenMarket, sort: MarketSort, order?: "asc" | "desc"): number {
  const direction = order ?? (sort === "name" ? "asc" : "desc");
  if (sort === "name") {
    const leftName = a.name ?? a.symbol;
    const rightName = b.name ?? b.symbol;
    if (leftName === null && rightName !== null) return 1;
    if (rightName === null && leftName !== null) return -1;
    const names = (leftName ?? "").localeCompare(rightName ?? "", "en");
    return (direction === "asc" ? names : -names) || a.address.localeCompare(b.address, "en");
  }
  const left = marketSortValue(a, sort);
  const right = marketSortValue(b, sort);
  if (left === null && right !== null) return 1;
  if (right === null && left !== null) return -1;
  if (left !== null && right !== null && left !== right) return direction === "asc" ? left - right : right - left;
  return a.address.localeCompare(b.address, "en");
}
