const text = { type: "string" } as const;
const nullableTime = { type: ["string", "null"], format: "date-time" } as const;
const tradability = { type: "string", enum: ["tradable", "untradable"] } as const;
export const CatalogPairSchema = {
  type: "object", properties: {
    id: text, symbol: text, display_only: { type: "boolean" }, tradability,
    tradability_by_account_type: { type: "object", additionalProperties: tradability },
    is_stablecoin: { type: "boolean" }, min_order_size: text, max_order_size: text,
    asset_currency: { type: "object", properties: { id: text, code: text, name: text, display_only: { type: "boolean" } }, required: ["id", "code", "name", "display_only"] },
    quote_currency: { type: "object", properties: { code: text }, required: ["code"] },
  }, required: ["id", "symbol", "display_only", "tradability", "tradability_by_account_type", "is_stablecoin", "min_order_size", "max_order_size", "asset_currency", "quote_currency"],
} as const;
const status = { type: "string", enum: ["tradable", "display_only", "not_in_app", "not_covered", "unavailable"] } as const;
const observation = {
  source: text, observedAt: nullableTime, ageSeconds: { type: ["integer", "null"] },
  stale: { type: "boolean" }, error: { type: ["string", "null"] },
} as const;
export const AppCatalogStatusSchema = {
  type: "object", properties: { ...observation, scope: { type: "string", const: "crypto_currency_pairs" }, reason: text, status, pairs: { type: "array", items: CatalogPairSchema }, match: { type: "string", enum: ["ticker_only", "none"] } },
  required: ["source", "observedAt", "ageSeconds", "stale", "error", "scope", "reason", "status", "pairs", "match"],
} as const;
export const AppCatalogPageSchema = {
  type: "object", properties: {
    ...observation, scope: { type: "string", const: "crypto_currency_pairs" }, chainId: { type: "integer" }, cadenceSeconds: { type: "integer" }, note: text,
    items: { type: "array", items: { type: "object", properties: {
      symbol: text, name: text, status, label: text, pairs: { type: "array", items: CatalogPairSchema }, marketsUrl: text,
    }, required: ["symbol", "name", "status", "label", "pairs", "marketsUrl"] } },
    total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" }, nextOffset: { type: ["integer", "null"] },
  }, required: ["source", "observedAt", "ageSeconds", "stale", "error", "scope", "chainId", "cadenceSeconds", "note", "items", "total", "limit", "offset", "nextOffset"],
} as const;
export const StockPairingSchema = {
  type: "object", properties: {
    id: text, poolId: text, venue: text, stockSymbol: text, stockAddress: text, canonicalAddress: text,
    stockVerdict: { type: "string", enum: ["canonical", "lookalike", "unconfirmed"] },
    communityName: { type: ["string", "null"] }, createdBlock: text,
    metadataStatus: { type: "string", enum: ["current", "stale", "pending", "failed"] },
    metadataAgeSeconds: { type: ["integer", "null"] }, metadataError: { type: ["string", "null"] },
    communityAddress: text, communitySymbol: { type: ["string", "null"] }, observedAt: nullableTime, lastSwapAt: nullableTime,
  }, required: ["id", "communityName", "createdBlock", "metadataStatus", "metadataAgeSeconds", "metadataError", "poolId", "venue", "stockSymbol", "stockAddress", "canonicalAddress", "stockVerdict", "communityAddress", "communitySymbol", "observedAt", "lastSwapAt"],
} as const;

export const StockPairingSummarySchema = {
  type: "object", properties: {
    totalPools: { type: "integer" }, counterparties: { type: "integer" }, resolvedCounterparties: { type: "integer" },
    pendingCounterparties: { type: "integer" }, observedSwapPools: { type: "integer" }, latestSwapAt: nullableTime,
    ranking: { type: "string", const: "latest_recorded_swap_then_resolved_metadata_then_creation_block_then_pool_id" },
    source: text, asOf: nullableTime, url: text,
  }, required: ["totalPools", "counterparties", "resolvedCounterparties", "pendingCounterparties", "observedSwapPools", "latestSwapAt", "ranking", "source", "asOf", "url"],
} as const;
export const StockPairingPageSchema = {
  type: "object", properties: {
    chainId: { type: "integer" }, address: { type: ["string", "null"] }, items: { type: "array", items: StockPairingSchema },
    total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" }, nextOffset: { type: ["integer", "null"] }, summary: StockPairingSummarySchema,
  }, required: ["chainId", "address", "items", "total", "limit", "offset", "nextOffset", "summary"],
} as const;
export const StockTokenMembershipSchema = {
  type: "object", properties: {
    source: { type: ["string", "null"] }, address: text, observedAt: nullableTime, ageSeconds: { type: ["integer", "null"] },
    verifiedAt: nullableTime, verified: { type: "boolean" },
  }, required: ["source", "address", "observedAt", "ageSeconds", "verifiedAt", "verified"],
} as const;
