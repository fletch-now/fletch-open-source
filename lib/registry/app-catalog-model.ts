import { z } from "zod";

export const APP_CATALOG_SOURCE = "https://nummus.robinhood.com/currency_pairs/";
export const APP_CATALOG_CADENCE_MS = 15_000;
export const APP_CATALOG_STALE_MS = 60_000;
const tradability = z.enum(["tradable", "untradable"]);
const decimal = z.string().regex(/^\d+(\.\d+)?$/);
export const catalogPairSchema = z.object({
  id: z.string().min(1), symbol: z.string().min(1), display_only: z.boolean(),
  tradability, tradability_by_account_type: z.record(z.string(), tradability),
  is_stablecoin: z.boolean(), min_order_size: decimal, max_order_size: decimal,
  asset_currency: z.object({ id: z.string().min(1), code: z.string().min(1), name: z.string().min(1), display_only: z.boolean() }),
  quote_currency: z.object({ code: z.string().min(1) }),
});
export const catalogPageSchema = z.object({ next: z.string().url().nullable(), results: z.array(catalogPairSchema).min(1) });
export type CatalogPair = z.infer<typeof catalogPairSchema>;
export const APP_CATALOG_SCOPE = "crypto_currency_pairs" as const;
export type AppStatus = "tradable" | "display_only" | "not_in_app" | "not_covered" | "unavailable";
export interface AppCatalogStatus {
  status: AppStatus;
  scope: typeof APP_CATALOG_SCOPE;
  reason: string;
  source: string;
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  error: string | null;
  pairs: CatalogPair[];
  match: "ticker_only" | "none";
}

export function appStatus(pairs: CatalogPair[]): AppStatus {
  if (!pairs.length) return "not_in_app";
  if (pairs.some((pair) => !pair.display_only && !pair.asset_currency.display_only && pair.tradability === "tradable" && Object.values(pair.tradability_by_account_type).includes("tradable"))) return "tradable";
  if (pairs.every((pair) => pair.display_only && pair.tradability === "untradable" && Object.values(pair.tradability_by_account_type).every((value) => value === "untradable"))) return "display_only";
  return "unavailable";
}

export function appStatusLabel(status: AppStatus): string {
  switch (status) {
    case "tradable": return "Crypto trading available";
    case "display_only": return "Crypto price feed only";
    case "not_in_app": return "Not found in Robinhood crypto catalog";
    case "not_covered": return "Stock Tokens use a separate catalog";
    default: return "Robinhood crypto catalog unavailable";
  }
}

export function orderSizeClamped(value: string): boolean {
  return /^0*1(?:\.0+)?$/.test(value);
}

export function changedCatalogFields(before: CatalogPair, after: CatalogPair): string[] {
  return (Object.keys(after) as Array<keyof CatalogPair>).filter(function changed(key) {
    function stable(value: unknown): string {
      if (value && typeof value === "object" && !Array.isArray(value)) return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
      return JSON.stringify(value);
    }
    return stable(before[key]) !== stable(after[key]);
  });
}
