export const ContractSearchMatchSchema = {
  type: "object",
  properties: {
    address: { type: "string", pattern: "^0x[0-9a-f]{40}$" },
    symbol: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    isin: { type: ["string", "null"] },
    source: {
      type: "string", enum: ["asset_list", "contract_metadata", "lookalike_scan", "explorer_candidate"],
      description: "The record that supplied the displayed label. asset_list includes registry assets from issuer, bridge and seed records. explorer_candidate is a reported identity awaiting independent contract checks.",
    },
    observedAt: { type: ["string", "null"], format: "date-time", description: "When the label's source was observed. Null means no observation yet; serving a cached result does not advance this time." },
    trust: { type: "string", enum: ["verified", "listed", "lookalike", "community", "unknown"], description: "Independent registry identity verdict. A search match does not grant verification." },
    trackedMarket: { type: "boolean", description: "Whether this address belongs to the tracked market set. It does not establish current price or activity coverage." },
  },
  required: ["address", "symbol", "name", "isin", "source", "observedAt", "trust", "trackedMarket"],
} as const;

export const ContractSearchPageSchema = {
  type: "object",
  properties: {
    query: { type: "string", maxLength: 128, description: "Normalized query after extracting supported links, ticker prefixes or chain-qualified addresses." },
    mode: { type: "string", enum: ["text", "address", "fragment", "pool", "isin"] },
    similar: { type: "boolean", description: "True when no literal text match was found and the response contains similar names or tickers. Inspect the full address before selecting a result." },
    items: { type: "array", items: ContractSearchMatchSchema },
    total: { type: "integer", minimum: 0, description: "Distinct matching recorded addresses before pagination. An empty page beyond the last result retains this total." },
    page: { type: "integer", minimum: 1, maximum: 99999 },
    pageSize: { type: "integer", enum: [10, 20, 50] },
    checkedAt: { type: "string", format: "date-time", description: "When the search result was computed. Use each item's observedAt for the underlying source age." },
  },
  required: ["query", "mode", "similar", "items", "total", "page", "pageSize", "checkedAt"],
} as const;

export const ContractSearchResponseSchema = {
  ...ContractSearchPageSchema,
  properties: {
    ...ContractSearchPageSchema.properties,
    chainId: { type: "integer", const: 4663 },
    scope: { type: "string" },
  },
  required: [...ContractSearchPageSchema.required, "chainId", "scope"],
} as const;
