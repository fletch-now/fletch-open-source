import type { TrustLevel } from "./trust-rules";
import type { MarketFilterValue, MarketSort } from "./market-filters";

export interface MetricObservation {
  sourceId: string | null;
  blockNumber: string | null;
  blockHash: string | null;
  sourceAt: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  method: string;
  parameters: Record<string, string | number | boolean | null>;
  inputs: MetricInput[];
  coverage: { status: "complete" | "partial" | "unknown"; scope: string; windowStartAt: string | null; windowEndAt: string | null };
  status: "current" | "stale" | "missing" | "invalid";
  readStatus: "ok" | "partial" | "failed" | "unread";
}

export interface MetricInput {
  name: string;
  asOf: string | null;
  value: string | number | null;
  observation: MetricObservation;
}

export interface PoolQuoteObservation {
  value: number | null;
  source: string | null;
  sourceId: string | null;
  sourceAt: string | null;
  fetchedAt: string | null;
  expiresAt: string | null;
  method: string;
  blockNumber: string | null;
  blockHash: string | null;
  parameters: Record<string, string | number | boolean | null>;
  reason: string | null;
}

export interface MarketSelection {
  selectedAt: string | null;
  expiresAt: string | null;
  policy: string;
  status: MetricObservation["status"];
}

export interface Metric<T> {
  value: T | null;
  source: string | null;
  asOf: string | null;
  reason: string | null;
  observation: MetricObservation;
}

export interface TokenAlternative {
  address: string;
  symbol: string | null;
  name: string | null;
  reason: string;
}

export interface TokenMarket {
  stockToken?: { source: string | null; address: string; observedAt: string | null; ageSeconds: number | null; verifiedAt: string | null; verified: boolean };
  stockPairingSummary?: import("./stock-pairings").StockPairingSummary;
  stockPairings?: import("./stock-pairings").StockPairing[];
  robinhoodApp?: import("./app-catalog-model").AppCatalogStatus;
  chainId: number;
  address: string;
  assetId: string | null;
  symbol: string | null;
  name: string | null;
  trust: TrustLevel;
  dominantAddress: string | null;
  selectionReason: string;
  selection: MarketSelection;
  closeCall: boolean;
  alternatives: TokenAlternative[];
  bestPoolId: string | null;
  poolCount: number;
  decimals: Metric<number>;
  totalSupplyRaw: Metric<string>;
  burnedRaw: Metric<string>;
  metadataReason: string | null;
  volumeScope: "selected_pool";
  priceUsd: Metric<number>;
  marketCapUsd: Metric<number>;
  volumeUsd24h: Metric<number>;
  transactions24h: Metric<number>;
  swaps24h: Metric<number>;
  holders: Metric<number>;
  v3QuoteHoldingsUsd: Metric<number>;
  v4OnePercentDepthUsd: Metric<number>;
}

export interface TokenMarketQuery {
  searchPage?: number;
  page?: number;
  pageSize?: 25 | 50;
  sort?: MarketSort;
  order?: "asc" | "desc";
  kind?: "all" | "listed" | "community";
  trust?: TrustLevel;
  query?: string;
  activity?: MarketFilterValue<"activity">;
  data?: MarketFilterValue<"data">;
  depth?: MarketFilterValue<"depth">;
  identity?: MarketFilterValue<"identity">;
  minVolumeUsd?: number;
}

export interface TokenMarketPage {
  contractSearchError?: string;
  contractSearch?: import("./contract-search").ContractSearchPage;
  catalog?: import("./app-catalog").CatalogReading;
  catalogMatches?: Array<{ symbol: string; name: string; status: import("./app-catalog-model").AppCatalogStatus; addresses: string[] }>;
  items: TokenMarket[];
  total: number;
  page: number;
  pageSize: 25 | 50;
  asOf: string;
  sort: MarketSort;
  order?: "asc" | "desc";
}
