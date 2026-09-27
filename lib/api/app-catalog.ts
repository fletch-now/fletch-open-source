import type { CatalogReading } from "@/lib/registry/app-catalog";
import { APP_CATALOG_CADENCE_MS, APP_CATALOG_SCOPE, appStatus, appStatusLabel, type AppStatus, type CatalogPair } from "@/lib/registry/app-catalog-model";

export interface AppCatalogQuery {
  q: string;
  status: AppStatus | null;
  limit: number;
  offset: number;
}

export function appCatalogQuery(params: URLSearchParams): AppCatalogQuery {
  const allowed = new Set(["q", "status", "limit", "offset"]);
  for (const key of params.keys()) {
    if (!allowed.has(key) || params.getAll(key).length !== 1) throw new Error(`Unknown or repeated query parameter: ${key}`);
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length > 128) throw new Error("q must be at most 128 characters");
  const status = params.get("status");
  if (status !== null && !["tradable", "display_only", "unavailable"].includes(status)) throw new Error("status must be tradable, display_only or unavailable");
  function integer(key: string, fallback: number, min: number, max: number): number {
    const raw = params.get(key);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
    return value;
  }
  return { q, status: status as AppStatus | null, limit: integer("limit", 100, 1, 200), offset: integer("offset", 0, 0, 1_000_000) };
}

export interface AppCatalogPage extends Omit<CatalogReading, "pairs"> {
  chainId: number;
  scope: typeof APP_CATALOG_SCOPE;
  cadenceSeconds: number;
  items: Array<{ symbol: string; name: string; status: AppStatus; label: string; pairs: CatalogPair[]; marketsUrl: string }>;
  total: number;
  limit: number;
  offset: number;
  nextOffset: number | null;
  note: string;
}

export function appCatalogPage(reading: CatalogReading, chainId: number, query: AppCatalogQuery): AppCatalogPage {
  const groups = new Map<string, CatalogPair[]>();
  for (const pair of reading.pairs) {
    const symbol = pair.asset_currency.code.toUpperCase();
    const group = groups.get(symbol) ?? [];
    group.push(pair);
    groups.set(symbol, group);
  }
  const search = query.q.toUpperCase();
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([symbol, pairs]) => {
    pairs.sort((a, b) => a.id.localeCompare(b.id));
    const status = appStatus(pairs);
    return { symbol, name: pairs[0].asset_currency.name, status, label: appStatusLabel(status), pairs,
      marketsUrl: `/api/v1/chains/${chainId}/markets?q=${encodeURIComponent(symbol)}` };
  }).filter((row) => (!query.status || row.status === query.status) && (!search || row.symbol.includes(search) || row.name.toUpperCase().includes(search)));
  const { source, observedAt, ageSeconds, stale, error } = reading;
  const items = rows.slice(query.offset, query.offset + query.limit);
  const nextOffset = query.offset + items.length < rows.length ? query.offset + items.length : null;
  return { chainId, scope: APP_CATALOG_SCOPE, source, observedAt, ageSeconds, stale, error, cadenceSeconds: APP_CATALOG_CADENCE_MS / 1000,
    items, total: rows.length, limit: query.limit, offset: query.offset, nextOffset,
    note: "Robinhood's crypto currency-pairs catalog, observed by Fletch. Stock Tokens have a separate address-based list; this source cannot establish their app availability. Price feed only means displayed without app trading. Symbols identify catalog entries; a shared ticker does not verify an on-chain contract. Use marketsUrl for contract observations. Check stale and error before using the recorded status." };
}
