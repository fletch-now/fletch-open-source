import type { TokenMarketQuery } from "@/lib/registry/token-markets-types";
import { normalizeContractQuery } from "@/lib/registry/contract-search-query";
import { MARKET_FILTER_KEYS, MARKET_FILTERS, type MarketFilterKey, type MarketFilterValue } from "@/lib/registry/market-filters";

function choice<K extends MarketFilterKey>(params: URLSearchParams, key: K): MarketFilterValue<K> {
  const definition = MARKET_FILTERS[key];
  const value = params.get(key) ?? definition.default;
  if (!definition.options.some((option) => option.value === value)) {
    throw new Error(`${key} must be one of: ${definition.options.map((option) => option.value).join(", ")}.`);
  }
  return value as MarketFilterValue<K>;
}

export function tokenMarketQuery(params: URLSearchParams): TokenMarketQuery {
  for (const key of [...MARKET_FILTER_KEYS, "q", "page", "pageSize", "minVolumeUsd", "searchPage"]) {
    if (params.getAll(key).length > 1) throw new Error(`${key} must be supplied once.`);
  }
  const pageText = params.get("page") ?? "1";
  if (!/^[1-9]\d{0,5}$/.test(pageText)) throw new Error("page must be a positive integer up to 999999.");
  const pageSize = params.get("pageSize") ?? "25";
  if (pageSize !== "25" && pageSize !== "50") throw new Error("pageSize must be 25 or 50.");
  const trust = choice(params, "trust");
  const input = params.get("q") ?? "";
  if (input.length > 2048) throw new Error("q must contain at most 2048 input characters.");
  const query = normalizeContractQuery(input);
  if (query.length > 128) throw new Error("q must contain at most 128 characters.");
  const result: TokenMarketQuery = {
    page: Number(pageText), pageSize: Number(pageSize) as 25 | 50,
    sort: choice(params, "sort"), kind: choice(params, "kind"), query,
    ...(trust === "all" ? {} : { trust }),
  };
  if (params.has("order")) result.order = choice(params, "order");
  if (params.has("searchPage")) {
    const searchPage = params.get("searchPage")!;
    if (!/^[1-9]\d{0,4}$/.test(searchPage)) throw new Error("searchPage must be a positive integer up to 99999.");
    result.searchPage = Number(searchPage);
  }
  for (const key of ["activity", "data", "depth", "identity"] as const) {
    const value = choice(params, key);
    if (value !== "all") Object.assign(result, { [key]: value });
  }
  if (params.has("minVolumeUsd")) {
    const raw = params.get("minVolumeUsd")!;
    const value = Number(raw);
    if (!/^\d+(\.\d+)?$/.test(raw) || !Number.isFinite(value) || value > 1_000_000_000_000) {
      throw new Error("minVolumeUsd must be a decimal number between 0 and 1000000000000.");
    }
    result.minVolumeUsd = value;
  }
  return result;
}

export function tokenMarketParams(query: TokenMarketQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of MARKET_FILTER_KEYS) {
    const value = query[key];
    if (value && (key === "order" || value !== MARKET_FILTERS[key].default)) params.set(key, value);
  }
  if (query.query) params.set("q", query.query);
  if (query.searchPage && query.searchPage !== 1) params.set("searchPage", String(query.searchPage));
  if (query.minVolumeUsd !== undefined) params.set("minVolumeUsd", String(query.minVolumeUsd));
  return params;
}
