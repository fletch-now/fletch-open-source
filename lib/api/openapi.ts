import { AppCatalogStatusSchema, AppCatalogPageSchema, CatalogPairSchema, StockPairingSchema, StockPairingPageSchema, StockPairingSummarySchema, StockTokenMembershipSchema } from "./app-catalog-schema";
import { POOL_DEPTH_DESCRIPTION } from "@/lib/api/market-descriptions";
import { PublicAppSchema, DirectoryTokenSchema } from "./directory-schema";
import { ContractSearchMatchSchema, ContractSearchPageSchema, ContractSearchResponseSchema } from "./contract-search-schema";
// The OpenAPI 3.1 document for exactly the v1 routes that exist, hand-written
// so it stays accurate. Served at /api/v1/openapi.json, rendered by Swagger UI
// at /api/v1/docs and by the developer reference at /developers.

// Scopes come from the dependency-free module rather than api-keys.ts, whose
// database driver would otherwise ride along into every importer of the spec.
import { MetricObservationSchema, MarketSelectionSchema, PoolQuoteObservationSchema } from "./metric-schema";
import { StatusSchema } from "./status-schema";
import { API_KEY_SCOPES } from "@/lib/auth/scopes";
import { MARKET_FILTER_KEYS, MARKET_FILTERS, MARKET_FILTER_CONTRACT } from "@/lib/registry/market-filters";

const ErrorSchema = {
  type: "object",
  properties: { error: { type: "string" } },
  required: ["error"],
} as const;

const ChainSchema = {
  type: "object",
  properties: {
    chainId: { type: "integer" },
    name: { type: "string" },
    network: { type: "string", enum: ["mainnet", "testnet"] },
    rpcUrl: { type: "string" },
    explorerUrl: { type: "string" },
    providerConfigured: { type: "boolean" },
  },
  required: ["chainId", "name", "network", "rpcUrl", "explorerUrl", "providerConfigured"],
} as const;

const AssetSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "`${chainId}:${address}`" },
    chainId: { type: "integer" },
    address: { type: "string" },
    symbol: { type: "string" },
    name: { type: "string" },
    assetType: { type: "string", enum: ["stock_token", "stablecoin", "wrapped_native", "bridged"] },
    decimals: { type: "integer" },
    status: { type: "string" },
    source: { type: "string" },
    sourceUri: { type: ["string", "null"] },
    observedAt: { type: "string", format: "date-time" },
    firstSeenAt: { type: "string", format: "date-time", description: "When Fletch first saw the token; Robinhood publishes no listing date" },
    verifiedAt: { type: ["string", "null"], format: "date-time" },
    onchainName: { type: ["string", "null"] },
    onchainSymbol: { type: ["string", "null"] },
    onchainDecimals: { type: ["integer", "null"] },
    metadataCheckedAt: { type: ["string", "null"], format: "date-time" },
    isin: { type: ["string", "null"] },
    logoUrl: { type: ["string", "null"] },
  },
  required: ["id", "chainId", "address", "symbol", "name", "assetType", "decimals", "status", "source"],
} as const;


// The live state block every asset carries (lib/registry/authority/shape.ts publicState).
const StateSchema = {
  type: ["object", "null"],
  description: "The asset's live state as the registry daemon last read it; every sub-block carries the time it was read.",
  properties: {
    multiplier: { type: ["number", "null"] },
    pendingMultiplier: { type: ["number", "null"] },
    multiplierEffectiveAt: { type: ["string", "null"], format: "date-time" },
    tokenPaused: { type: ["boolean", "null"] },
    oraclePaused: { type: ["boolean", "null"] },
    totalSupplyRaw: { type: ["string", "null"] },
    totalSupplyUi: { type: ["string", "null"] },
    canonical: { type: ["boolean", "null"] },
    beacon: { type: ["string", "null"] },
    implementation: { type: ["string", "null"] },
    feed: { type: ["object", "null"], properties: { address: { type: "string" }, price: { type: ["number", "null"] }, updatedAt: { type: ["string", "null"] }, stale: { type: ["boolean", "null"] } } },
    quote: { type: ["object", "null"], properties: { bid: { type: ["number", "null"] }, ask: { type: ["number", "null"] }, tradingHalt: { type: ["boolean", "null"] }, dailyVolume: { type: ["number", "null"] }, at: { type: ["string", "null"] } } },
    priceDivergencePct: { type: ["number", "null"] },
    dex: { type: ["object", "null"], description: "The deepest dollar-priced pool and its premium to the feed." },
    secondSource: { type: ["object", "null"], description: "The chain explorer's holders, transfers and supply, with supplyAgreement agree|close|differ|unknown." },
    checkedAt: { type: ["string", "null"], format: "date-time" },
  },
} as const;

// One changelog row (lib/registry/authority/shape.ts publicAuthorityEvent).
// `kind` is not an enum here: kinds are added over time, and the response's
// `kinds` array is the list the running daemon can emit.
const AuthorityEventSchema = {
  type: "object",
  description: "One entry in the registry changelog. `id` is stable across re-runs; the cursor for the row is `${observedAt}|${id}`.",
  properties: {
    id: { type: "string", description: "`ev_` followed by 24 hex characters; the same change is never written twice" },
    kind: { type: "string", description: "A dotted kind such as `registry.paused` or `multiplier.applied`; every kind the daemon can emit is in the response's `kinds`", example: "multiplier.applied" },
    title: { type: "string", description: "The change as one changelog line" },
    symbol: { type: ["string", "null"], description: "The token concerned; null for a chain-wide event" },
    address: { type: ["string", "null"], description: "The contract or account concerned; null for a chain-wide event" },
    detail: { type: ["object", "null"], additionalProperties: true, description: "The numbers behind the title; fields depend on the kind" },
    block: { type: ["string", "null"], description: "Block number as a decimal string; null for events not tied to a block" },
    txHash: { type: ["string", "null"] },
    occurredAt: { type: "string", format: "date-time", description: "When the change happened on chain or at the source" },
    observedAt: { type: "string", format: "date-time", description: "When the daemon recorded it; the cursor orders by this" },
  },
  required: ["id", "kind", "title", "symbol", "address", "detail", "block", "txHash", "occurredAt", "observedAt"],
} as const;

const TrustSchema = {
  type: "object",
  description: "Derived from the row: whether bytecode was found and the contract agrees with the listing.",
  properties: { level: { type: "string", enum: ["verified", "listed", "lookalike", "community", "unknown"] }, label: { type: "string" }, detail: { type: "string" } },
} as const;

const WatcherSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    projectId: { type: ["string", "null"] },
    name: { type: "string" },
    kind: { type: "string", enum: ["large_transfer", "wallet_activity", "registry_event", "listing_event", "token_event", "new_pool"] },
    chainId: { type: "integer" },
    address: { type: "string" },
    assetId: { type: ["string", "null"] },
    threshold: { type: "string" },
    wallet: { type: ["string", "null"], description: "wallet_activity only — the watched address." },
    delivery: { type: "string", enum: ["telegram", "webhook"], description: "Where this watcher's alerts are sent." },
    webhookId: { type: ["string", "null"], description: "The endpoint alerts are posted to when delivery is \"webhook\"." },
    webhookName: {
      type: ["string", "null"],
      description:
        "The endpoint's name. Null when delivery is \"telegram\". Also null when the endpoint was deleted: delivery stays \"webhook\", webhookId is null, and the watcher is paused with the reason in lastError. Such a watcher cannot be resumed until it is re-pointed with PATCH /watchers/{id} { webhookId }.",
    },
    enabled: { type: "boolean" },
    status: { type: "string", enum: ["active", "catching_up", "degraded", "paused"] },
    lastCheckedBlock: { type: ["string", "null"] },
    lastTriggeredAt: { type: ["string", "null"], format: "date-time" },
    lastError: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    lastDelivery: {
      type: ["object", "null"],
      description: "The latest recorded match, including dashboard-only matches. sentAt is null until a notification is sent.",
      properties: {
        createdAt: { type: "string", format: "date-time", description: "When Fletch saved this match." },
        status: { type: "string", enum: ["pending", "sent", "failed", "retracted", "held"] },
        sentAt: { type: ["string", "null"], format: "date-time" },
        amount: { type: ["string", "null"] },
        txHash: { type: "string" },
      },
      required: ["createdAt", "status", "sentAt", "amount", "txHash"],
    },
  },
  required: ["id", "name", "kind", "chainId", "address", "threshold", "enabled", "status", "createdAt", "updatedAt", "lastDelivery"],
} as const;

const RunSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    watcherId: { type: "string" },
    status: { type: "string", enum: ["pending", "sent", "failed", "retracted"] },
    lastError: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
    sentAt: { type: ["string", "null"], format: "date-time" },
    payload: {
      type: "object",
      description:
        "DeliveryPayload — kind, chainId, address, symbol, from, to, value, amount, threshold, txHash, logIndex, blockNumber, blockHash, explorerUrl; wallet_activity adds wallet and direction (\"in\" | \"out\"); an authority payload (kind \"authority\", from a registry_event or token_event watcher) instead carries eventId, eventKind, title, symbol, address, detail, txHash, blockNumber, occurredAt (ISO 8601 UTC), explorerUrl and registryUrl.",
    },
  },
  required: ["id", "watcherId", "status", "createdAt", "payload"],
} as const;

const WebhookSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    url: { type: "string" },
    secretPrefix: { type: "string", description: "The first characters of the signing secret; the secret itself is returned only once, at creation or rotation." },
    enabled: { type: "boolean" },
    createdAt: { type: "string", format: "date-time" },
    lastDeliveredAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "When this endpoint last answered 2xx, including test pings — not necessarily an alert.",
    },
    lastError: {
      type: ["string", "null"],
      description:
        "The most recent failure whenever it happened, cleared by the next success. Compare lastErrorAt with lastDeliveredAt before reading it as a fault now.",
    },
    lastErrorAt: {
      type: ["string", "null"],
      format: "date-time",
      description: "When lastError was written. Null on an endpoint whose last failure predates this field.",
    },
    lastTestAt: { type: ["string", "null"], format: "date-time", description: "Latest connection test, separate from watcher alerts. Null before separate reporting began or after secret rotation." },
    lastTestStatus: { type: ["integer", "null"], description: "HTTP status returned by the latest test. Null for a transport failure or no test." },
    lastTestError: { type: ["string", "null"] },
    lastAlertAt: { type: ["string", "null"], format: "date-time", description: "Latest attempt to deliver a watcher match. A timestamp alone does not mean it was accepted." },
    lastAlertStatus: { type: ["integer", "null"], description: "HTTP status of that alert attempt; 2xx means the receiver acknowledged it." },
    lastAlertError: { type: ["string", "null"] },
    secret: {
      type: "string",
      description: "Present only in the response that created or rotated this endpoint. Stored encrypted and never returned again.",
    },
  },
  required: ["id", "name", "url", "secretPrefix", "enabled", "createdAt"],
} as const;

// The one response that carries the plaintext secret: creation and rotation.
const WebhookCreatedSchema = {
  allOf: [WebhookSchema, { type: "object", required: ["secret"] }],
} as const;

// The outbound delivery: what a receiver has to parse. Described under the
// document's top-level `webhooks` keyword, not under paths — nothing calls this
// on Fletch, Fletch calls it on you.
const WebhookDeliverySchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Delivery id, `dl_…` (`ping_…` for a test); the idempotency key." },
    kind: { type: "string", enum: ["large_transfer", "wallet_activity", "authority", "ping"] },
    payload: RunSchema.properties.payload,
    watcher: {
      type: ["object", "null"],
      properties: { id: { type: "string" }, name: { type: "string" }, kind: { type: "string" } },
      description: "null for a ping, which belongs to the endpoint rather than to any watcher.",
    },
    queuedAt: { type: "string", format: "date-time", description: "When Fletch matched the event. On a retry this is well before sentAt." },
    attempt: { type: "integer", description: "1 on the first try." },
    sentAt: { type: "string", format: "date-time", description: "When this attempt was posted." },
  },
  required: ["id", "kind", "payload", "queuedAt", "attempt", "sentAt"],
} as const;

const ProjectSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    slug: { type: "string" },
    createdAt: { type: "string", format: "date-time" },
    buildCount: { type: "integer" },
  },
  required: ["id", "name", "slug", "createdAt", "buildCount"],
} as const;

const BuildDetailSchema = {
  type: "object",
  properties: {
    build: {
      type: "object",
      properties: {
        id: { type: "string" },
        projectId: { type: ["string", "null"] },
        prompt: { type: "string" },
        status: { type: "string" },
        billingMode: { type: ["string", "null"], enum: ["platform", "own_key", null], description: "Immutable queued billing choice. Null means the older record did not capture this choice." },
        custodyMode: { type: ["string", "null"], enum: ["platform", "hosted", "gateway", null] },
        provider: { type: "string" },
        model: { type: ["string", "null"] },
        capabilities: { type: ["object", "null"], properties: { text: { type: "boolean" }, tools: { type: "boolean" }, images: { type: "boolean" } } },
        error: { type: ["string", "null"] },
        startedAt: { type: ["string", "null"], format: "date-time" },
        finishedAt: { type: ["string", "null"], format: "date-time" },
        createdAt: { type: "string", format: "date-time" },
      },
    },
    previewUrl: { type: ["string", "null"], description: "The project's confirmed public site. A newer build can be an unpublished preview." },
    publication: {
      type: ["object", "null"],
      description: "Current project publication state, which can refer to a newer build. Preview links expire after 30 minutes; read this endpoint again for a fresh link.",
      properties: {
        draft: { type: ["object", "null"], properties: {
          buildId: { type: "string" }, previewUrl: { type: "string", format: "uri" },
          createdAt: { type: "string", format: "date-time" }, bytes: { type: "integer" },
        } },
        live: { type: ["object", "null"], properties: { buildId: { type: ["string", "null"] }, url: { type: "string", format: "uri" } } },
        job: { type: ["object", "null"], properties: {
          buildId: { type: "string" }, state: { type: "string", enum: ["queued", "publishing", "published", "failed"] }, error: { type: ["string", "null"] },
        } },
      },
    },
    contracts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          chainId: { type: "integer" },
          address: { type: "string" },
          verified: { type: ["boolean", "null"] },
          deployer: { type: "string" },
        },
      },
    },
    templateVersion: { type: ["string", "null"], description: "Sandbox frontend template version recorded for this build. Null when unknown, including legacy builds." },
    compile: { type: ["object", "null"], description: "forge build --json result, or null if not yet compiled." },
    tests: { type: ["object", "null"], description: "forge test --json result, or null if not yet run." },
    analysis: { type: ["object", "null"], description: "Recorded Slither result, including whether the tool ran." },
    artifacts: { type: "array", items: { type: "object" } },
  },
} as const;

const DexTokenSchema = {
  type: ["object", "null"],
  description: "The unlisted side of a community pool, as its own contract describes it. Nothing here is verified.",
  properties: {
    address: { type: "string" },
    symbol: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    decimals: { type: ["integer", "null"] },
    totalSupplyRaw: { type: ["string", "null"], description: "Base units; divide by 10^decimals." },
    fdvUsd: { type: ["number", "null"], description: "Total supply times the pool's dollar price." },
    burnedRaw: { type: ["string", "null"], description: "Sum of readable balances at the zero and dead addresses, in base units." },
    marketCapUsd: { type: ["number", "null"], description: "Total supply minus zero/dead-address balances, times the pool price. An upper bound on circulating value. Null without supply, burn balances, decimals or usable price, or when recorded burns exceed supply. Confirmed zero outstanding supply renders zero." },
    supplyReadAt: { type: ["string", "null"], format: "date-time" },
    supplyExpiresAt: { type: ["string", "null"], format: "date-time" },
    supplyCurrent: { type: "boolean", description: "Supply and recorded burn balances are at most five minutes old. FDV and capitalization are withheld otherwise." },
    readAt: { type: ["string", "null"], format: "date-time" },
  },
} as const;

const TokenTrustLevelSchema = { type: "string", enum: ["verified", "listed", "community", "lookalike", "unknown"] } as const;
const ObservedNumberSchema = {
  type: "object", properties: {
    value: { type: ["number", "null"] }, source: { type: ["string", "null"] },
    asOf: { type: ["string", "null"], format: "date-time", description: "Compatibility observation time. Derived capitalization uses the oldest required input time; inspect observation.inputs for each input." }, reason: { type: ["string", "null"] },
    observation: { $ref: "#/components/schemas/MetricObservation" },
  }, required: ["value", "source", "asOf", "reason", "observation"],
} as const;
const ObservedRawSchema = { ...ObservedNumberSchema, properties: { ...ObservedNumberSchema.properties, value: { type: ["string", "null"], pattern: "^[0-9]+$" } } } as const;
const TokenMarketSchema = {
  type: "object", properties: {
    robinhoodApp: AppCatalogStatusSchema, stockToken: StockTokenMembershipSchema, stockPairingSummary: StockPairingSummarySchema, stockPairings: { type: "array", items: StockPairingSchema },
    chainId: { type: "integer" }, address: { type: "string" }, assetId: { type: ["string", "null"] },
    symbol: { type: ["string", "null"] }, name: { type: ["string", "null"] }, trust: TokenTrustLevelSchema,
    selection: MarketSelectionSchema, dominantAddress: { type: ["string", "null"] }, selectionReason: { type: "string" }, closeCall: { type: "boolean" },
    alternatives: { type: "array", items: { type: "object", properties: {
      address: { type: "string" }, symbol: { type: ["string", "null"] }, name: { type: ["string", "null"] }, reason: { type: "string" },
    }, required: ["address", "symbol", "name", "reason"] } },
    bestPoolId: { type: ["string", "null"] }, poolCount: { type: "integer" },
    decimals: ObservedNumberSchema, totalSupplyRaw: ObservedRawSchema, burnedRaw: ObservedRawSchema,
    metadataReason: { type: ["string", "null"] }, volumeScope: { const: "selected_pool" },
    priceUsd: ObservedNumberSchema, marketCapUsd: ObservedNumberSchema, volumeUsd24h: ObservedNumberSchema,
    swaps24h: ObservedNumberSchema, transactions24h: ObservedNumberSchema, holders: ObservedNumberSchema,
    v3QuoteHoldingsUsd: ObservedNumberSchema, v4OnePercentDepthUsd: ObservedNumberSchema,
  }, required: ["chainId", "address", "trust", "selection", "selectionReason", "alternatives", "priceUsd", "marketCapUsd", "volumeUsd24h", "holders", "volumeScope"],
} as const;

const DexPoolSchema = {
  type: "object",
  properties: {
    poolId: { type: "string" },
    venue: { type: "string", enum: ["uniswap_v4", "uniswap_v3"] },
    kind: { ...TokenTrustLevelSchema, description: "Alias of trust for the priced token. Listing membership is separate." },
    trust: TokenTrustLevelSchema, trustDetail: { type: "string" }, tokenAddress: { type: ["string", "null"] },
    listing: { type: "string", enum: ["listed", "unlisted"] },
    depthMeasure: { type: "string", enum: ["quote_holdings", "bounded_one_percent_quote", "unavailable"] },
    depthSource: { type: ["string", "null"] },
    quoteObservation: PoolQuoteObservationSchema,
    tier: { type: "string", enum: ["active", "quiet", "dormant"], description: "Active pools are prioritized for background sampling; quiet pools receive a daily cycle; dormant pools receive demand-driven reads. Scheduling does not establish freshness: inspect stateCheckedAt and stateCurrent." },
    lastSwapAt: { type: ["string", "null"], format: "date-time" },
    poolAddress: { type: ["string", "null"] },
    currency0: { type: "string" },
    currency1: { type: "string" },
    fee: { type: "integer" },
    feeDynamic: { type: "boolean" },
    feePct: { type: ["number", "null"] },
    tickSpacing: { type: "integer" },
    hooks: { type: "string" },
    asset: { type: ["string", "null"], description: "The listed asset's ticker; null for a community pool." },
    token: DexTokenSchema,
    quote: { type: ["string", "null"] },
    createdBlock: { type: "string" },
    sqrtPriceX96: { type: ["string", "null"] },
    tick: { type: ["integer", "null"] },
    liquidity: { type: ["string", "null"] },
    depthUsd: { type: ["number", "null"], description: POOL_DEPTH_DESCRIPTION },
    priceInQuote: { type: ["number", "null"] },
    priceUsd: { type: ["number", "null"] },
    swaps24h: { type: ["integer", "null"] },
    transactions24h: { type: ["integer", "null"], description: "Distinct transactions in the exact indexed 24-hour window." },
    metricsAsOf: { type: ["string", "null"], format: "date-time", description: "End of the indexed 24-hour window; metrics expire after 120 seconds." },
    metricsWindowStartAt: { type: ["string", "null"], format: "date-time" },
    metricsCoverageComplete: { type: "boolean" },
    metricsCurrent: { type: "boolean" },
    volume0Raw: { type: ["string", "null"], description: "Sum of absolute currency0 swap amounts in base units, only for a complete current window." },
    volume1Raw: { type: ["string", "null"], description: "Sum of absolute currency1 swap amounts in base units. Separate from currency0; the legs are never added together." },
    volumeUsd24h: { type: ["number", "null"] },
    volumeValuation: { type: ["object", "null"], description: "Historical quote method, source and missing-value reason. USDG is nominal denomination; WETH uses a bounded-age historical oracle estimate." },
    stateCheckedAt: { type: ["string", "null"], format: "date-time" },
    stateCurrent: { type: "boolean", description: "The pool state was observed within three minutes, its timestamp is not in the future, and its captured quote conversion has not expired. When false, depth, price, FDV and price changes are null; stateCheckedAt retains the actual observation time." },
    pricePublished: { type: "boolean", description: "Current state has a finite positive price and clears the configured depth floor." },
    change5mPct: { type: ["number", "null"], description: "Dollar price against the newest sample at or before five minutes ago; null when no sample is old enough." },
    change1hPct: { type: ["number", "null"] },
    change6hPct: { type: ["number", "null"] },
    change24hPct: { type: ["number", "null"] },
  },
  required: ["poolId", "venue", "kind", "currency0", "currency1", "fee", "createdBlock", "stateCurrent", "pricePublished"],
} as const;

const VenueSchema = {
  type: "object",
  properties: {
    venue: { type: "string", enum: ["uniswap_v4", "uniswap_v3"] },
    pools: { type: "integer", description: "Pools that trade a listed asset against a listed quote." },
    pricedPools: { type: "integer", description: "Of those, how many the state read has put a dollar price on." },
    depthUsd: { type: ["number", "null"], description: `${POOL_DEPTH_DESCRIPTION} Venue depth is the sum over its priced pools.` },
    swaps24h: { type: ["integer", "null"], description: "Swap logs in the exact indexed 24-hour window, null for incomplete or stale coverage." },
    volumeUsd24h: { type: ["number", "null"], description: "USD over the same exact window using historical per-swap valuations; null when valuations are incomplete." },
    assetsPricedHere: { type: "integer" },
    checkedAt: { type: ["string", "null"], format: "date-time", description: "When the state read last priced a pool on this venue." },
  },
  required: ["venue", "pools", "pricedPools", "swaps24h", "assetsPricedHere"],
} as const;

const VenueScanSchema = {
  type: "object",
  properties: {
    venue: { type: "string" },
    scanned: { type: "boolean", description: "Discovery has read this venue at least once; false means no pool from it is listed yet because nothing has looked." },
    scannedToBlock: { type: ["string", "null"] },
    headBlock: { type: ["string", "null"] },
    headAt: { type: ["string", "null"], format: "date-time", description: "When the chain head above was read." },
    blocksBehind: { type: ["string", "null"] },
    readingHistory: { type: "boolean" },
  },
  required: ["venue", "scanned", "readingHistory"],
} as const;

const bearerAuth = { bearerFormat: "flk_...", type: "http", scheme: "bearer" } as const;

type ApiResponse = {
  description: string;
  content: { "application/json": { schema: object } };
};

function response(description: string, schema: object): ApiResponse {
  return { description, content: { "application/json": { schema } } };
}

const errorResponses = {
  "401": response("Missing or invalid credentials; carries WWW-Authenticate", ErrorSchema),
  "403": response("Credentials valid but missing the required scope", ErrorSchema),
  "429": response("The key's hourly budget is spent; Retry-After says when the window ends", ErrorSchema),
};

const anonymousLimited = response("Too many anonymous requests from this address; Retry-After says when the window ends", ErrorSchema);

const untagged = {
  openapi: "3.1.0",
  info: {
    title: "Fletch v1 API",
    version: "1.0.0",
    description:
      "Read the registry, and read/create/pause/delete watchers, key-authenticated (Authorization: Bearer flk_...). A signed-in browser session also authenticates, with every scope below. See /llms.txt for a plain-text guide (docs/API.md in the repository has the same material at length). Watcher alerts can be delivered to a webhook endpoint registered under /webhooks, signed with HMAC-SHA256. Not yet in v1: deploy. Public reads (every operation marked `security: []`) answer with `Access-Control-Allow-Origin: *` and a preflight, so a browser on any origin can fetch them without credentials; the keyed operations under /watchers, /webhooks, /projects and /builds send no CORS headers and are for servers. Every public read carries an ETag and a Cache-Control; a 429 carries Retry-After; a 401 carries WWW-Authenticate. A keyed operation names its scope in `x-required-scope`.",
  },
  servers: [{ url: "https://fletch.now/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/apps": {
      get: {
        summary: "Browse publicly listed apps",
        description: "Public beta directory. Only owner-submitted, admin-approved listings for the current published build are returned. Unlisted, suspended, pending, deleted and banned-owner apps are omitted. Descriptions are creator-provided. Responses must revalidate on every read so revoked listings are removed. Sorted by featured, then first listing time. Pagination can change as owners edit listings.",
        security: [],
        parameters: [
          { name: "q", in: "query", schema: { type: "string", maxLength: 80 }, description: "Full-text search over app name and descriptions, or an exact token ticker (optional $ prefix) or contract address." },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 1000, default: 1 }, description: "24 apps per page. Follow next until null." },
        ],
        responses: {
          "200": response("Approved app listings", { type: "object", properties: { apps: { type: "array", items: PublicAppSchema }, page: { type: "integer" }, hasMore: { type: "boolean" }, next: { type: ["string", "null"] } }, required: ["apps", "page", "hasMore", "next"] }),
          "429": anonymousLimited,
        },
      },
    },
    "/apps/{slug}": {
      get: {
        summary: "Read a publicly listed app",
        description: "Public. Returns the same approved description and token evidence as /published/{slug}. A 404 also covers private or withdrawn listings. No prompts, source files, owner identity or build logs are included.",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": response("Public app and optional token observation", { type: "object", properties: { app: PublicAppSchema }, required: ["app"] }), "404": response("App not publicly listed", ErrorSchema), "429": anonymousLimited },
      },
    },
    "/chains": {
      get: {
        summary: "List Robinhood Chain networks",
        description: "Public. The public RPC URL, the explorer and whether Fletch has a provider key for the chain; a configured provider URL is never returned.",
        security: [],
        responses: {
          "200": response("The two Robinhood chains", {
            type: "object",
            properties: { chains: { type: "array", items: ChainSchema } },
          }),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets": {
      get: {
        summary: "Search issuer-listed assets and their recorded chain observations",
        description:
          "Public. Anonymous callers get 120 requests a minute per address; a key or a session uses its own budget. Each asset carries `state`: multiplier, pending multiplier, pause flags, supply, recorded beacon dependency, the Chainlink feed and Robinhood's quote.",
        security: [],
        parameters: [
          { name: "trust", in: "query", schema: { type: "string", enum: ["verified", "listed", "lookalike", "community", "unknown"] }, description: "Filter the Robinhood listing collection by its shared trust verdict. Community tokens are resolved by /tokens/{address} and listed under /dex/pools; they are not added to Robinhood's registry." },
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Symbol or name substring" },
          { name: "symbols", in: "query", required: false, schema: { type: "string" }, example: "TSLA,AAPL", description: "Comma-separated exact tickers, up to 200; any past that are ignored" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["symbol", "name", "type", "address", "verified", "multiplier", "price", "lookalikes", "state", "newest", "holders", "float"] }, description: "Sort the entire filtered collection before pagination. Identity uses verified/listed metadata agreement; state uses the displayed state label. Without browse parameters the legacy registry ordering is preserved." },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"] }, description: "Text and state default ascending; identity, numeric values and first-listed dates default descending. Missing values are last in either direction; equal values use contract address ascending." },
          { name: "type", in: "query", schema: { type: "string", enum: ["all", "stock_token", "stablecoin", "wrapped_native", "bridged"] }, description: "Listing asset category" },
          { name: "verified", in: "query", schema: { type: "string", enum: ["0", "1"] }, description: "1 requires the contract symbol and decimals to match the listing with a verification receipt" },
          { name: "state", in: "query", schema: { type: "string", enum: ["all", "feed", "stale", "paused", "halted", "pending", "residual", "divergent", "lookalikes"] }, description: "Filter recorded authority state" },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50 }, description: "Opt into pagination, default 50 when offset is supplied. Omit both limit and offset to retain the complete collection." },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 1000000 }, description: "Rows to skip after all filters and sorting, default 0" },
          { name: "fields", in: "query", required: false, schema: { type: "string" }, example: "lookalikes,feedRounds,concentration", description: "Extra per-asset blocks: lookalikes, corporateActions, multiplierHistory, feedRounds, concentration (up to 50 assets)" },
        ],
        responses: {
          "200": response("Assets, each with trust and state, plus any extra blocks fields= asked for", {
            type: "object",
            properties: {
              assets: { type: "array", items: { allOf: [AssetSchema, { type: "object", properties: { trust: TrustSchema, state: StateSchema, lookalikes: { type: "array", items: { type: "object" } }, corporateActions: { type: "array", items: { type: "object" } }, multiplierHistory: { type: "array", items: { type: "object" } }, feedRounds: { type: "array", items: { type: "object" } } } }] } },
              total: { type: "integer", description: "Full matching count when pagination is requested" },
              limit: { type: "integer" },
              offset: { type: "integer" },
              nextOffset: { type: ["integer", "null"], description: "Next offset, or null at the end of the filtered collection" },
              fields: { type: "array", items: { type: "string" }, description: "The extra blocks a caller may request" },
            },
          }),
          "400": response("Invalid or repeated query parameter, or fields= was set on more than 50 assets", ErrorSchema),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}": {
      get: {
        summary: "Get one registry asset by symbol, with its state, multiplier history, mints and burns, supply snapshots, corporate actions and control-plane events",
        description: "Public, rate-limited per address when anonymous. Raw amounts are strings (exact on chain); prices and multipliers are numbers.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" } },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "AAPL" },
        ],
        responses: {
          "200": response("The asset with everything the registry knows about it", {
            type: "object",
            properties: {
              asset: AssetSchema,
              trust: TrustSchema,
              state: StateSchema,
              multiplierHistory: { type: "array", items: { type: "object" } },
              supplyEvents: { type: "array", items: { type: "object" } },
              supplySnapshots: { type: "array", items: { type: "object" } },
              corporateActions: { type: "array", items: { type: "object" } },
              controlEvents: { type: "array", items: { type: "object" } },
              lookalikes: { type: "array", items: { type: "object" } },
              feedRounds: { type: "array", items: { type: "object" } },
            },
          }),
          "404": response("No such asset on this chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/control-plane": {
      get: {
        summary: "The issuer's AccessControlsRegistry: paused, implementation, blocked-address count, and its latest events",
        description:
          "Public. One contract governs every Stock Token: this is the surface no other index publishes. `limit` caps events (default 50, max 200), newest first. `offset` skips that many events, so `offset=200&limit=200` is the second page; an event that lands between two page reads repeats one row on the next page, so a consumer copying the log dedupes by `txHash` and `logIndex`. A page shorter than `limit` is the last one. `state` is the same on every page.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 }, description: "Events per page (default 50)" },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0 }, description: "Events to skip before the page (default 0)" },
        ],
        responses: {
          "200": response("Registry state and events", { type: "object", properties: { state: { type: "object" }, events: { type: "array", items: { type: "object" } } } }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/health": {
      get: {
        summary: "The chain's latest vital signs: head, block time, base fee, L1 block, batch count, delayed messages, batch-poster balance, status page",
        security: [],
        parameters: [{ name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 }],
        responses: {
          "200": response("Latest reading", { type: "object", properties: { health: { type: "object" } } }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/corporate-actions": {
      get: {
        summary: "Corporate actions in progress, as Robinhood publishes them, tied to the token each affects",
        security: [],
        parameters: [{ name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 }],
        responses: {
          "200": response("Actions in progress", { type: "object", properties: { actions: { type: "array", items: { type: "object" } } } }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}/holders": {
      get: {
        summary: "Holders largest first with share of supply and what each address is, holder count, the latest concentration reading with the shares that say where the supply sits, and whether the ledger has reached the chain head",
        description:
          "Public. `sits` is always one of `float`, `pools`, `issuer`, `bridge`, `contracts`, `unknown`, and names the concentration share this address's balance counts towards; `unknown` means the code probe has not checked this address yet. `label` and `labelKind` (`pool_manager`, `dex_pool`, `issuer`, `bridge_gateway`, `locker`, `contract`, `exchange`, `eoa`) are null for an address the registry has nothing to say about. `rawBalance` is in the token's base units; divide by 10^`decimals`. `sharePct` is that balance over `totalSupplyRaw`, read live, while the concentration shares are over the sum of every positive balance the ledger held at `concentration.asOfBlock`, so the two can differ slightly while the ledger trails the chain. `concentration` carries `top1Pct`, `top10Pct` and `gini` over every positive balance, and the six shares `floatPct`, `poolsPct`, `issuerPct`, `bridgePct`, `contractsPct` and `unknownPct`, which add to 100: float is the supply in ordinary wallets. `unknownPct` is the share held by addresses the code probe has not checked — it checks every holder above a ten-thousandth of a token's supply, so a tail of small holdings stays here permanently and `floatPct` is always a floor rather than a final answer. `issuerPct` is the share of every wallet labelled `issuer`, which is written only for Stock Tokens, whose mints are the issuer creating inventory; `issuerAddress` is this asset's largest mint recipient whatever the asset type. `concentration.day` is the UTC day of the reading, `takenAt` the ISO instant the job wrote it, and `asOfBlock` the ledger block it was computed at; the job runs every 24 h, so a share can be up to a day old. `concentration.holders` is the address count at that moment, while the top-level `holderCount` is read live and can differ. The shares come from the daily concentration job, which does not run while the transfer ledger is still reading history, so `concentration` is null until the ledger reaches head.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "TSLA" },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 50 }, description: "How many holders, largest first" },
        ],
        responses: {
          "200": response("Holders", {
            type: "object",
            properties: {
              symbol: { type: "string" },
              decimals: { type: "integer" },
              totalSupplyRaw: { type: ["string", "null"], description: "Live total supply in base units, the denominator of sharePct" },
              holders: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    holder: { type: "string" },
                    rawBalance: { type: "string", description: "Base units; divide by 10^decimals" },
                    sharePct: { type: ["number", "null"] },
                    asOfBlock: { type: "string" },
                    label: { type: ["string", "null"] },
                    labelKind: { type: ["string", "null"], enum: ["pool_manager", "dex_pool", "issuer", "bridge_gateway", "locker", "contract", "exchange", "eoa", null] },
                    sits: { type: "string", enum: ["float", "pools", "issuer", "bridge", "contracts", "unknown"] },
                  },
                },
              },
              holderCount: { type: "integer" },
              concentration: { type: ["object", "null"] },
              progress: { type: "object" },
            },
          }),
          "404": response("Asset not found", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}/activity": {
      get: {
        summary: "Transfers as economics, one row per UTC day: transfers, volume, mints, burns, DvP against USDG, off-hours transfers",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "TSLA" },
          { name: "days", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 400, default: 30 }, description: "How many UTC days back; a malformed value reads as the default" },
        ],
        responses: {
          "200": response("Days", { type: "object", properties: { days: { type: "array", items: { type: "object" } } } }),
          "404": response("Asset not found", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}/pools": {
      get: {
        summary: "Pools trading the asset on every DEX the registry reads, deepest first, with venue, price, liquidity, fee, hooks, last-day swaps and volume, and the pool behind the asset's premium to the feed",
        description:
          "Public. `venue` is `uniswap_v4` or `uniswap_v3`; a v4 pool is an id inside the one PoolManager and has a null `poolAddress`, a v3 pool is a contract and carries its address. A pool is recorded when one side is this asset and the other is a listed quote (USDG, WETH or another Stock Token). Pools are deepest first by `depthUsd`. V3 depth uses observed quote-side holdings. V4 depth uses a bounded quote estimate for a 1% price move, where per-pool token reserves are unavailable; `liquidity` is the pool's in-range Uniswap liquidity L in raw units, not a dollar figure, and is comparable only between pools of the same pair (its scale follows the two tokens' decimals). `best` is the deepest pool in dollars of any venue, which is the one the asset's premium to the Chainlink feed is measured from, and names its venue. `swaps24h` counts swap logs and `transactions24h` counts distinct transactions in (metricsAsOf - 24 hours, metricsAsOf], using each event block timestamp. Values are null until the entire window is indexed and when its end is more than 120 seconds old. `volumeUsd24h` uses the indexed quote leg. USDG is nominally denominated at 1 USDG = $1; WETH uses a recorded historical oracle estimate with at most one-hour archive sample age and an oracle answer within its published heartbeat. `volumeValuation` retains the method and coverage reason. Zero means a completely scanned window with no matching activity. `discovery` says how far each venue's pool scan has read: while `readingHistory` is true, a pool created in blocks the scan has not reached yet is not listed, and a venue whose `scanned` is false has not been read at all.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "TSLA" },
        ],
        responses: {
          "200": response("Pools", {
            type: "object",
            properties: { pools: { type: "array", items: { type: "object" } }, best: { type: ["object", "null"] }, discovery: { type: "array", items: VenueScanSchema }, note: { type: "string" } },
          }),
          "404": response("Asset not found", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/tokens/{address}": {
      get: {
        summary: "Token identity and current market observations at one contract address",
        description:
          "Public. The canonical trust verdict is shared by pages and pool responses. A lookalike records a normalized name or ticker collision; it does not establish intent. `reading` is the exact token-page observation: full address, economic selection reason, same-name alternatives, selected-pool volume, market cap and holders with source, timestamp and missing-value reason. Community dominance is an economic comparison. `market` retains the compact selected-pool view. V3 quote holdings and V4 bounded 1% quote input are separate measures. Volume sources distinguish nominal USDG quote units from WETH converted with a historical oracle estimate.",
        security: [],
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, example: "0x0000000000000000000000000000000000000000" }],
        responses: {
          "200": response("What this token is", {
            type: "object",
            properties: {
              chainId: { type: "integer" },
              address: { type: "string" },
              trust: { type: "string", enum: ["verified", "listed", "lookalike", "community", "unknown"] },
              label: { type: "string" },
              detail: { type: "string" },
              impersonates: { type: ["object", "null"], properties: { symbol: { type: "string" }, name: { type: "string" }, address: { type: "string" }, registryUrl: { type: "string" } } },
              symbol: { type: ["string", "null"] },
              name: { type: ["string", "null"] },
              decimals: { type: ["integer", "null"] },
              source: { type: "string", enum: ["registry", "discovered", "none"] },
              firstSeenAt: { type: ["string", "null"], format: "date-time" },
              readAt: { type: ["string", "null"], format: "date-time" },
              registryUrl: { type: ["string", "null"] },
              explorerUrl: { type: "string" },
              reading: { anyOf: [TokenMarketSchema, { type: "null" }] },
              market: { type: ["object", "null"], properties: { poolId: { type: "string" }, venue: { type: "string" }, priceUsd: { type: ["number", "null"] }, depthUsd: { type: ["number", "null"] }, swaps24h: { type: ["integer", "null"] }, transactions24h: { type: ["integer", "null"] }, metricsAsOf: { type: ["string", "null"], format: "date-time" }, priceSource: { const: "dex" }, volumeUsd24h: { type: ["number", "null"] } } },
              note: { type: "string" },
            },
            required: ["chainId", "address", "trust", "label", "detail", "source", "explorerUrl"],
          }),
          "400": response("Not an address", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/stock-pairings": {
      get: {
        operationId: "getStockPairings", summary: "Discovered stock/community pools with counterparty metadata and pagination",
        description: "All recorded canonical factory pools for a verified stock contract or a same-ticker lookalike. Filter by stock, canonical stock, or community address. Each pool and stock side has a stable id. Sorted by latest recorded swap, resolved metadata, descending creation block, then pool id. A missing swap is unobserved activity, not zero. Summary counts cover the full filtered set; token market rows contain up to three grouped representatives. Offset pages reflect the current database and can move as swaps arrive.",
        security: [], parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } },
          { name: "address", in: "query", schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 1000000, default: 0 } },
        ], responses: {
          "200": response("Recorded pairings and complete filtered counts", StockPairingPageSchema),
          "503": response("Pairing database read unavailable", ErrorSchema),
          "400": response("Invalid query", ErrorSchema), "404": response("Unsupported chain", ErrorSchema), "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/app-catalog": {
      get: {
        operationId: "getAppCatalog", summary: "Robinhood crypto currency-pairs catalog with source scope and observation age",
        description: "Public. Scope is crypto_currency_pairs. Stock Tokens use a separate address-based list. Legacy status not_in_app means only no matching crypto ticker; stock_token assets return not_covered. Includes symbols without a known on-chain contract. Display-only means a price feed without app trading. Inspect per-account tradability, stale and error. Symbols are ticker matches, not contract verification. Follow nextOffset until null. Pages read the current snapshot, which can change between requests. The observer targets 15 seconds; this endpoint reads its stored result.",
        security: [], parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } },
          { name: "q", in: "query", schema: { type: "string", maxLength: 128 } },
          { name: "status", in: "query", schema: { type: "string", enum: ["tradable", "display_only", "unavailable"] } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
          { name: "offset", in: "query", schema: { type: "integer", minimum: 0, maximum: 1000000, default: 0 } },
        ], responses: {
          "200": response("Recorded app catalog, with freshness and source errors", AppCatalogPageSchema),
          "400": response("Invalid query", ErrorSchema), "404": response("Unsupported chain", ErrorSchema),
          "503": response("No catalog observation yet", AppCatalogPageSchema), "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/discoveries": {
      get: {
        operationId: "getTokenDiscoveries",
        summary: "Latest token addresses recorded by Fletch",
        description: "Public. Includes community contracts with successfully read metadata and bytecode, plus active Stock Token and bridged-asset records. Hidden contracts are excluded. Deduplicated by address, ordered by firstSeenAt descending with address ties. Listed addresses retain the earliest known observation. First recorded is not a contract deployment date, Robinhood app listing or evidence of trading. Coverage is incomplete and historical indexing can discover old contracts. asOf is the read snapshot time; firstSeenAt and metadataCheckedAt keep their source times. The Registry sidebar and /registry/feed.xml use the same read model. Supports ETag and a fifteen-second cache. Polling returns a bounded latest window, not a complete event archive.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 50, default: 20 } },
        ],
        responses: {
          "200": response("Recent address discoveries with identity and observation times", { type: "object", properties: {
            chainId: { type: "integer" }, asOf: { type: "string", format: "date-time" }, scope: { type: "string" },
            items: { type: "array", items: { type: "object", properties: {
              address: { type: "string" }, symbol: { type: "string" }, name: { type: ["string", "null"] },
              source: { type: "string", enum: ["contract_metadata", "asset_list"] },
              firstSeenAt: { type: "string", format: "date-time" }, metadataCheckedAt: { type: ["string", "null"], format: "date-time" }, trust: TrustSchema,
            }, required: ["address", "symbol", "name", "source", "firstSeenAt", "metadataCheckedAt", "trust"] } },
          }, required: ["chainId", "asOf", "scope", "items"] }),
          "304": { description: "Discovery window unchanged. Reuse the previous response." },
          "400": response("Invalid query", ErrorSchema), "404": response("Unsupported chain", ErrorSchema),
          "429": anonymousLimited, "503": response("Token discoveries unavailable", ErrorSchema),
        },
      },
    },
    "/chains/{chainId}/search": {
      get: {
        operationId: "searchTokenContracts",
        summary: "Search recorded token contracts across the registry",
        description: "Public. Searches active asset records, visible contract metadata, lookalike observations and explorer candidates, including addresses outside tracked markets. Accepts case-insensitive tickers with optional $, names with words in any order, recorded on-chain aliases, ISINs, full or shortened addresses, 4663:address or eip155:4663:address, supported token/address/pool URLs, V3 pool addresses and V4 pool IDs. Pool matches return their recorded currencies. Address prefixes require at least four hexadecimal characters; shortened addresses may use an ellipsis or three dots with at least four characters on each side. Results deduplicate by address and retain source, observedAt, trust and trackedMarket. Missing metadata remains null. When text of at least four characters has no literal match, similar names or tickers may be returned with similar=true. An unknown address or empty result does not prove that no contract exists. Supply each parameter once; unsupported parameters return 400. Responses support ETag and a fifteen-second cache. Pagination reads the current recorded data and may change as indexing advances.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } },
          { name: "q", in: "query", description: "Search text or a supported URL. At most 2048 input characters and 128 characters after normalization. Omit for an empty result.", schema: { type: "string", maxLength: 2048 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 99999, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", enum: [10, 20, 50], default: 10 } },
        ],
        responses: {
          "200": response("Matching contract records with source age and identity verdict", ContractSearchResponseSchema),
          "304": { description: "Search result unchanged. Reuse the body from the previous successful response." },
          "400": response("Invalid query or pagination", ErrorSchema), "404": response("Unsupported chain", ErrorSchema),
          "429": anonymousLimited, "503": response("Contract search unavailable", ErrorSchema),
        },
      },
    },
    "/chains/{chainId}/markets": {
      get: {
        summary: "Priority tokens, one contract per row, ordered by observed selected-pool volume",
        description: "Public. The unfiltered market table contains tracked tokens. A full address can request another recorded contract's readings. q also returns contractSearch across the recorded registry, with its own total and ten-result pages selected by searchPage; market filters apply to items, not to contractSearch. contractSearchError preserves an unavailable search as an error while existing market readings can still return. Each market metric carries structured observation provenance, computation inputs, coverage, source/fetch times and expiry, alongside compatibility source/asOf/reason fields. Pool state expires after three minutes, changing supply and burn balances after five minutes, and selected-pool swap windows after two minutes. Capitalization expires with its earliest-expiring required input. Missing provenance remains null. Selection time and its fifteen-minute policy expiry are explicit; stale selection withholds dominance. Volume covers the selected pool only. Numeric sorts support order=asc or desc, with unavailable values last and stable contract-address ties. Name sorts ascending when order is omitted. Raw market observations can be shared for ten seconds, while ages, expiry and filtering are recomputed per request. Contract search can be cached for fifteen seconds. Source timestamps retain their observation times. Economic dominance does not change a trust verdict. A missing price or incomplete activity window remains unavailable.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 999999, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", enum: [25, 50], default: 25 } },
          { name: "searchPage", in: "query", description: "Independent page of ten contractSearch matches when q is supplied. Market pagination still uses page and pageSize.", schema: { type: "integer", minimum: 1, maximum: 99999, default: 1 } },
          ...MARKET_FILTER_KEYS.map(function marketParameter(key) {
            const definition = MARKET_FILTERS[key];
            return { name: key, in: "query", description: definition.options.map((option) => `${option.value}: ${option.description}`).join(" "), schema: { type: "string", enum: definition.options.map((option) => option.value), ...(key === "order" ? {} : { default: definition.default }) } };
          }),
          { name: "minVolumeUsd", in: "query", description: MARKET_FILTER_CONTRACT.minVolumeUsd.description, schema: { type: "number", minimum: 0, maximum: 1_000_000_000_000 } },
          { name: "q", in: "query", description: "Ticker, words in a name, ISIN, full or shortened address, chain-qualified address, supported URL or pool identifier. The normalized query must be at most 128 characters. Matching recorded contracts appear in contractSearch; a full token address also requests its market readings.", schema: { type: "string" } },
        ],
        responses: {
          "200": response("A page of token observations", { type: "object", properties: {
            chainId: { type: "integer" }, items: { type: "array", items: TokenMarketSchema }, total: { type: "integer" },
            contractSearch: ContractSearchPageSchema,
            contractSearchError: { type: "string", description: "Present when contract search could not be read. Existing market readings can still be returned; this is not an empty search result." },
            catalog: { type: "object", properties: { source: { type: "string" }, observedAt: { type: ["string", "null"] }, ageSeconds: { type: ["integer", "null"] }, stale: { type: "boolean" }, error: { type: ["string", "null"] }, pairs: { type: "array", items: CatalogPairSchema } }, required: ["source", "observedAt", "ageSeconds", "stale", "error", "pairs"] },
            catalogMatches: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, name: { type: "string" }, status: AppCatalogStatusSchema, addresses: { type: "array", items: { type: "string" } } }, required: ["symbol", "name", "status", "addresses"] } },
            page: { type: "integer" }, pageSize: { type: "integer" }, sort: { type: "string" }, order: { type: "string", enum: ["asc", "desc"] }, asOf: { type: "string", format: "date-time" },
            scope: { type: "string" }, note: { type: "string" },
            appliedFilters: { type: "object", additionalProperties: { type: "string" }, description: "Normalized non-default filter values; defaults are in filterDefinitionsUrl. Page and pageSize are returned separately." },
            filterDefinitionsUrl: { type: "string" },
          }, required: ["chainId", "items", "total", "page", "pageSize", "asOf", "sort"] }),
          "400": response("Invalid query", ErrorSchema), "404": response("Unsupported chain", ErrorSchema), "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/markets/filters": {
      get: {
        summary: "Discover token-market filters, labels, thresholds and useful query presets",
        description: "The catalog used by the token Markets page and query parser. Combine filters with AND. Activity requires a complete current selected-pool window. Numeric thresholds exclude unavailable data, including for a threshold of zero. V3 quote holdings and V4 bounded depth are separate filters and sorts.",
        security: [],
        parameters: [{ name: "chainId", in: "path", required: true, schema: { type: "integer", const: 4663 } }],
        responses: {
          "200": response("Machine-readable market filter catalog", { type: "object", properties: {
            chainId: { type: "integer", const: 4663 }, version: { type: "integer" }, scope: { type: "string" }, combination: { type: "string" }, ordering: { type: "string" },
            filters: { type: "object", properties: Object.fromEntries(MARKET_FILTER_KEYS.map(function definition(key) {
              return [key, { type: "object", properties: { label: { type: "string" }, default: { type: "string" }, options: { type: "array", items: { type: "object", properties: { value: { type: "string" }, label: { type: "string" }, description: { type: "string" } }, required: ["value", "label", "description"] } } }, required: ["label", "default", "options"] }];
            })), required: MARKET_FILTER_KEYS },
            minVolumeUsd: { type: "object", properties: { label: { type: "string" }, minimum: { type: "number" }, maximum: { type: "number" }, description: { type: "string" } }, required: ["label", "minimum", "maximum", "description"] },
            presets: { type: "array", items: { type: "object", properties: { label: { type: "string" }, query: { type: "object", additionalProperties: { type: "string" } } }, required: ["label", "query"] } },
          }, required: ["chainId", "version", "scope", "combination", "ordering", "filters", "minVolumeUsd", "presets"] }),
          "404": response("Unsupported chain", ErrorSchema), "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/dex/pools": {
      get: {
        summary: "Indexed pools with token identity, separate depth measures and current swap observations",
        description:
          "Public. `kind=listed` filters membership in Robinhood's list; `kind=community` keeps unlisted priced tokens; `kind=lookalike` selects recorded collisions. The response `kind` is an alias of the canonical `trust` verdict; `listing` retains membership separately. `sort=volume` ranks actual current 24-hour volume, missing values last, with pool identity as the tie-break. `traction` explicitly adds depth and swap-count tie-breaks. Search accepts token names, tickers, full contracts, v3 pool addresses and v4 pool IDs. Swap and transaction counts require a complete current window. Volume sources distinguish nominal USDG denomination and historical WETH oracle estimates. V3 quote holdings and V4 bounded 1% quote input retain distinct labels and never form a combined TVL.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["all", "listed", "community", "lookalike"], default: "all" }, description: "Also accepted as `trust`." },
          { name: "tier", in: "query", required: false, schema: { type: "string", enum: ["active", "quiet", "dormant", "all"], default: "active" }, description: "Which tiers to list; the default is the pools worth watching." },
          { name: "sort", in: "query", required: false, schema: { type: "string", enum: ["traction", "depth", "volume", "swaps", "newest"], default: "volume" } },
          { name: "venue", in: "query", required: false, schema: { type: "string", enum: ["uniswap_v4", "uniswap_v3"] } },
          { name: "q", in: "query", required: false, schema: { type: "string" }, description: "Token or pool name, symbol, or a complete 0x address. Addresses are matched in full.", example: "PIPE" },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 } },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, default: 0 } },
        ],
        responses: {
          "200": response("A page of pools", {
            type: "object",
            properties: {
              pools: { type: "array", items: DexPoolSchema },
              total: { type: "integer" },
              limit: { type: "integer" },
              offset: { type: "integer" },
              kind: { type: "string" },
              tier: { type: "string" },
              sort: { type: "string" },
              venue: { type: ["string", "null"] },
              q: { type: ["string", "null"] },
              discovery: { type: "array", items: VenueScanSchema },
              note: { type: "string" },
            },
            required: ["pools", "total", "limit", "offset", "discovery"],
          }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/dex": {
      get: {
        summary: "The DEX venues the registry reads and what each contributes: pools trading a listed asset, how many carry a dollar price, the last day's swaps and volume, and how many assets take their premium from a pool there",
        description:
          "Public. One row per venue read (`uniswap_v4`, `uniswap_v3`), whether or not it has a pool on record yet, so `venues` and `discovery` name the same set. `assetsPricedHere` counts the assets whose deepest pool in dollars sits on that venue, so the venues' figures add up to the assets with a DEX price. `depthUsd` sums depth over the venue's priced pools: observed quote-side holdings for v3, and a bounded quote estimate for a 1% price move for v4 where per-pool token reserves are unavailable; Uniswap's raw liquidity L compares two pools only when they hold the same pair. `swaps24h` counts swap logs and `transactions24h` counts distinct transactions in (metricsAsOf - 24 hours, metricsAsOf], using each event block timestamp. Values are null until the entire window is indexed and when its end is more than 120 seconds old. `volumeUsd24h` uses the indexed quote leg. USDG is nominally denominated at 1 USDG = $1; WETH uses a recorded historical oracle estimate with at most one-hour archive sample age and an oracle answer within its published heartbeat. `volumeValuation` retains the method and coverage reason. Zero means a completely scanned window with no matching activity. `checkedAt` is when the state read last priced a pool on that venue; `headAt` inside `discovery` is when the chain head there was read. `discovery` carries each venue's pool scan position against that head; while `readingHistory` is true the counts are a floor, not a total, and while `scanned` is false the venue has not been read at all. The Pons launchpad creates its pools on the Uniswap v3 factory, so they are counted as `uniswap_v3` rather than as a venue of their own.",
        security: [],
        parameters: [{ name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 }],
        responses: {
          "200": response("DEX venues", {
            type: "object",
            properties: { venues: { type: "array", items: VenueSchema }, discovery: { type: "array", items: VenueScanSchema }, note: { type: "string" } },
          }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}/history": {
      get: {
        summary: "One row per UTC day of everything the registry publishes about an asset: multiplier, pause and halt flags, feed price and staleness, bid and ask, divergence, DEX price, premium and liquidity, supply, holders and lookalike count",
        description:
          "Public. Written by the state-daily job, which runs hourly and rewrites the current UTC day's row, so a past day can be read back; the live tables carry only the current answer. Each row is a single reading taken at `takenAt`, not a daily open, close, mean or end-of-day value: it is the last reading the job took on that day, and the row for the current day is rewritten on the job's next run, so today's row is a partial day. Compare `takenAt` across rows before treating the series as evenly spaced. `from`/`to` are UTC days and default to the last 90; `days` sets the window length instead of `from`; `at=YYYY-MM-DD` returns that one day (an empty `days` array when no snapshot was taken); `fields` narrows each row to the keys named, `day` always included. `coverage` says how many days are actually on record and the first of them: there is nothing before the day the job first ran. A null is a figure that was not read that day, never a zero: a figure is copied only when the job that writes it read it that day, and `stateCheckedAt`, `feedCheckedAt`, `apiCheckedAt`, `dexCheckedAt` and `blockscoutCheckedAt` say when each group of figures was last read. `ledgerHolders` is written only for assets whose transfer history the ledger had finished reading, and `lookalikes` only once the lookalike scan has completed a pass. Rows are flat versions of the live `state` block: `feedPrice`/`feedStale` are `state.feed.price`/`.stale`, `bid`/`ask`/`tradingHalt` are `state.quote.bid`/`.ask`/`.tradingHalt`, `dexPriceUsd`/`dexPremiumPct`/`dexLiquidity` are `state.dex.priceUsd`/`.premiumPct`/`.liquidity`, `blockscoutHolders` is `state.secondSource.holders`, `multiplier` is `state.multiplier`.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "TSLA" },
          { name: "from", in: "query", required: false, schema: { type: "string", format: "date" }, description: "First UTC day, YYYY-MM-DD; must not be after `to`" },
          { name: "to", in: "query", required: false, schema: { type: "string", format: "date" }, description: "Last UTC day, YYYY-MM-DD; defaults to today" },
          { name: "days", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 3650, default: 90 }, description: "Window length in days ending at `to`; ignored when `from` is given" },
          { name: "at", in: "query", required: false, schema: { type: "string", format: "date" }, example: "2026-08-12" },
          {
            name: "fields",
            in: "query",
            required: false,
            schema: { type: "string" },
            example: "feedPrice,dexPremiumPct",
            description:
              "Comma-separated keys to keep from each row: multiplier, tokenPaused, oraclePaused, tradingHalt, feedPrice, feedStale, bid, ask, priceDivergencePct, dexPriceUsd, dexPremiumPct, dexLiquidity, totalSupplyRaw, blockscoutHolders, ledgerHolders, lookalikes, stateCheckedAt, feedCheckedAt, apiCheckedAt, dexCheckedAt, blockscoutCheckedAt, takenAt. `day` is always included; an unknown key is a 400.",
          },
        ],
        responses: {
          "200": response("History", {
            type: "object",
            properties: {
              chainId: { type: "integer" },
              symbol: { type: "string" },
              decimals: { type: "integer", description: "Token decimals, for converting totalSupplyRaw" },
              from: { type: "string" },
              to: { type: "string" },
              coverage: { type: "object", properties: { daysOnRecord: { type: "integer" }, firstDay: { type: ["string", "null"] }, latestDay: { type: ["string", "null"] } } },
              days: { type: "array", items: { type: "object" } },
            },
          }),
          "400": response("at, from, to, days or fields is malformed, or from is after to", ErrorSchema),
          "404": response("Asset not found", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/assets/{symbol}/feed/rounds": {
      get: {
        summary: "The Chainlink feed's round history for one asset, newest first: roundId, answer (price × multiplier, USD), startedAt, updatedAt",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "TSLA" },
          { name: "since", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 2000, default: 200 }, description: "Rounds, newest first; a malformed value reads as the default, a larger one as the maximum" },
        ],
        responses: {
          "200": response("Rounds", { type: "object", properties: { symbol: { type: "string" }, feed: { type: ["string", "null"] }, rounds: { type: "array", items: { type: "object" } } } }),
          "404": response("Asset not found", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/bridge": {
      get: {
        summary: "The token bridge: each bridged asset's L1 escrow against its L2 supply, recent deposits and withdrawals seen on L2, and withdrawals past their seven-day window",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "query", required: false, schema: { type: "string" }, example: "WBTC" },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 }, description: "Flows, newest first; a malformed value reads as the default, a larger one as the maximum" },
        ],
        responses: {
          "200": response("Bridge", { type: "object", properties: { escrow: { type: "array", items: { type: "object" } }, flows: { type: "array", items: { type: "object" } }, claimable: { type: "array", items: { type: "object" } } } }),
          "404": response("Unknown chain or asset", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/status": {
      get: {
        summary: "Whether the registry is live: the daemon's heartbeat, every job against its cadence, the scanners still reading history, and the age of every published figure",
        description:
          "Public. Always 200; the verdict is in the body ('live', 'degraded', 'stale', 'never'), so a stale registry is a fact to read rather than an error to retry. A running worker is degraded when at least 10 jobs are failing, late, stalled or awaiting their first completed run; fewer than 10 keeps the overall verdict live. Individual job results remain visible. Each job carries its cadence, last successful run, age and verdict ('fresh', 'late', 'failing', 'filling', 'stalled', 'never'); metadataBacklog reports the measured due, visible, never-read and failed token counts after the last successful metadata batch; filling does not mean complete coverage; each figure names the job that writes it and the newest timestamp behind it. Also served at /api/v1/status.",
        security: [],
        parameters: [{ name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 }],
        responses: {
          "200": response("Freshness", StatusSchema),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/status": {
      get: {
        summary: "Alias of /chains/4663/status: whether the registry is live",
        security: [],
        responses: { "200": response("Freshness", StatusSchema), "429": anonymousLimited },
      },
    },
    "/chains/{chainId}/issuer": {
      get: {
        summary: "The issuer's paperwork: every PDF the legal hub lists with ETag, Last-Modified and the token it maps to, plus watched pages and when their text changed",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["base_prospectus", "supplement", "notice", "final_terms", "other"] } },
        ],
        responses: {
          "200": response("Documents and pages", { type: "object", properties: { documents: { type: "array", items: { type: "object" } }, pages: { type: "array", items: { type: "object" } } } }),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/lookalikes": {
      get: {
        summary: "Recorded name and ticker collisions at different contract addresses, with available holder counts and beacon checks",
        description:
          "Public. Most held first, missing holder counts last, then address and row id. symbol and kind apply the same filters as the Lookalikes page. kind=unverified includes legacy unlisted_stock observations; a shared beacon records a dependency, not issuer origin. total counts the complete filtered set; follow nextOffset until null. A collision describes reused labels; it does not establish intent or issuer identity. `limit` caps rows (default 300, max 1000); `offset` skips that many rows, so `offset=1000&limit=1000` is the second page, and a page shorter than `limit` is the last one. Holder counts are refreshed by the lookalike scan, so the order can shift between pages read across a scan: a consumer copying the whole table dedupes by `address`.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "symbol", in: "query", required: false, schema: { type: "string" }, example: "TSLA" },
          { name: "kind", in: "query", required: false, schema: { type: "string", enum: ["impostor", "same_ticker", "unverified", "unlisted_stock"] }, description: "Collision category. unlisted_stock is a legacy alias for unverified." },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 1000 }, description: "Rows per page (default 300)" },
          { name: "offset", in: "query", required: false, schema: { type: "integer", minimum: 0, maximum: 1000000 }, description: "Rows to skip before the page (default 0)" },
        ],
        responses: {
          "200": response("Lookalikes, most held first", { type: "object", properties: { lookalikes: { type: "array", items: { type: "object" } }, total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" }, nextOffset: { type: ["integer", "null"] } }, required: ["lookalikes"] }),
          "400": response("Invalid query", ErrorSchema),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/events": {
      get: {
        summary: "The registry changelog: every pause, block, upgrade, multiplier change, stale feed, supply residual, listing, corporate action and chain status change the daemon recorded",
        description:
          "Public. Without `since`/`cursor`: newest first, with `kinds` (every kind the daemon can emit) and `nextCursor`. With `since` or `cursor` (an ISO instant, use the previous `nextCursor`): only newer rows, oldest first, so a consumer catches up without gaps; a `since` or `cursor` that does not parse is a 400, never a silent restart from now. `kind` matches exactly or by prefix (`registry.`, `multiplier.`) and `symbol` narrows to one token, on the newest-first read only: the cursor read returns every kind, and a consumer following a cursor filters on `kind` itself. `limit` up to 500. When the changelog is empty, `nextCursor` is the epoch, which passed back yields every event from the first.",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "kind", in: "query", required: false, schema: { type: "string" }, example: "multiplier." },
          { name: "symbol", in: "query", required: false, schema: { type: "string" }, example: "TSLA" },
          { name: "since", in: "query", required: false, schema: { type: "string", format: "date-time" } },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "An opaque position, `${observedAt}|${id}`, as returned in `nextCursor`. Pass it back verbatim; a bare ISO instant is also accepted.",
            example: "2026-09-05T11:50:43.476Z|ev_9f3256ce83b6dd98fedbe4ec",
          },
          { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 500, default: 100 }, description: "A malformed value reads as the default, a larger one as the maximum" },
        ],
        responses: {
          "200": response("Events", {
            type: "object",
            properties: {
              events: { type: "array", items: AuthorityEventSchema },
              kinds: { type: "array", items: { type: "string" }, description: "Every kind the daemon can emit; present only on the newest-first read (no `since`/`cursor`)" },
              nextCursor: { type: "string", description: "`${observedAt}|${id}` of the last row seen; pass it back as `cursor` to receive only what follows. The epoch when the changelog is empty." },
            },
            required: ["events", "nextCursor"],
          }),
          "400": response("since or cursor is malformed", ErrorSchema),
          "404": response("Unknown chain", ErrorSchema),
          "429": anonymousLimited,
        },
      },
    },
    "/chains/{chainId}/events/stream": {
      get: {
        summary: "The same changelog as Server-Sent Events; each frame's id is the event's cursor (`${observedAt}|${id}`), so Last-Event-ID (or ?since=) resumes without gaps",
        security: [],
        parameters: [
          { name: "chainId", in: "path", required: true, schema: { type: "integer" }, example: 4663 },
          { name: "since", in: "query", required: false, schema: { type: "string" }, description: "An ISO instant or a cursor `${observedAt}|${id}`; the Last-Event-ID header takes precedence. Without either the stream starts at now." },
        ],
        responses: {
          "200": { description: "text/event-stream; `event` is the kind, `data` an AuthorityEvent as JSON, `id` the event's cursor. The first frame carries `retry` and an `id` with no event, so a reconnect always has a position." },
          "400": response("since or Last-Event-ID is malformed", ErrorSchema),
          "404": response("Unknown chain", ErrorSchema),
          "429": response("Too many anonymous requests, or too many open streams from this address", ErrorSchema),
        },
      },
    },
    "/watchers": {
      get: {
        summary: "List this account's watchers",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:read",
        responses: {
          "200": response("Watchers", { type: "object", properties: { watchers: { type: "array", items: WatcherSchema } } }),
          ...errorResponses,
        },
      },
      post: {
        summary: "Create a watcher",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [
          {
            name: "Idempotency-Key",
            in: "header",
            required: false,
            schema: { type: "string" },
            description: "Repeat a POST with the same key to get the same watcher back instead of creating another.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  assetId: { type: "string", description: "Required for large_transfer, wallet_activity and token_event; omitted for registry_event." },
                  threshold: {
                    type: "string",
                    example: "1000",
                    description: "Required for large_transfer (positive) and wallet_activity (\"0\" means every transfer); ignored by registry_event, token_event and new_pool.",
                  },
                  kind: {
                    type: "string",
                    enum: ["large_transfer", "wallet_activity", "registry_event", "listing_event", "token_event", "new_pool"],
                    default: "large_transfer",
                  },
                  lookalikesOnly: {
                    type: "boolean",
                    description: "new_pool only: alert only on a pool whose token borrows a listed ticker or name. Off by default.",
                  },
                  wallet: {
                    type: "string",
                    description: "Required when kind is wallet_activity — a 0x-prefixed 40-character hex address.",
                    example: "0x1234567890123456789012345678901234567890",
                  },
                  name: { type: "string" },
                  projectId: { type: "string" },
                  webhookId: {
                    type: "string",
                    description: "Deliver this watcher to a registered webhook endpoint instead of Telegram.",
                  },
                },
                required: [],
              },
            },
          },
        },
        responses: {
          "201": response("Created", { type: "object", properties: { watcher: WatcherSchema } }),
          "200": response("Idempotency-Key replay: the existing watcher", { type: "object", properties: { watcher: WatcherSchema } }),
          "400": response("Invalid asset id, threshold, wallet, project, or a disabled webhook endpoint", ErrorSchema),
          "404": response("Asset, project or webhook endpoint not found", ErrorSchema),
          ...errorResponses,
          "429": response("Per-account or platform watcher limit reached", ErrorSchema),
        },
      },
    },
    "/watchers/{id}": {
      get: {
        summary: "Get one watcher",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:read",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": response("The watcher", { type: "object", properties: { watcher: WatcherSchema } }),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
      patch: {
        summary: "Pause, resume, or re-point a watcher",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                description: "Send enabled, webhookId, or both.",
                properties: {
                  enabled: { type: "boolean" },
                  webhookId: {
                    type: ["string", "null"],
                    description:
                      "Re-point this watcher: an endpoint id delivers there, null goes back to Telegram. The endpoint must be yours and enabled.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": response("Updated", { type: "object", properties: { watcher: WatcherSchema } }),
          "400": response("Neither enabled nor webhookId was sent, or the endpoint is not yours, is disabled, or was deleted", ErrorSchema),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
      delete: {
        summary: "Delete a watcher",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": response("Deleted", { type: "object", properties: { ok: { type: "boolean" } } }),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
    },
    "/watchers/{id}/runs": {
      get: {
        summary: "A watcher's delivery history",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:read",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", required: false, schema: { type: "integer", default: 50, maximum: 200 } },
        ],
        responses: {
          "200": response("Deliveries, newest first", { type: "object", properties: { runs: { type: "array", items: RunSchema } } }),
          "404": response("Watcher not found", ErrorSchema),
          ...errorResponses,
        },
      },
    },
    "/webhooks": {
      get: {
        summary: "List this account's webhook endpoints",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:read",
        responses: {
          "200": response("Endpoints, oldest first", { type: "object", properties: { webhooks: { type: "array", items: WebhookSchema } } }),
          ...errorResponses,
        },
      },
      post: {
        summary: "Register a webhook endpoint",
        description:
          "Returns the signing secret once. Every delivery carries X-Fletch-Signature: t=<unix>,v1=<hex hmac-sha256 over \"<t>.<body>\"> and X-Fletch-Event.",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", description: "An https:// URL on a public host.", example: "https://example.com/fletch" },
                  name: { type: "string", description: "Defaults to the URL's host." },
                },
                required: ["url"],
              },
            },
          },
        },
        responses: {
          "201": response("Created, with the secret shown once", { type: "object", properties: { webhook: WebhookCreatedSchema } }),
          "400": response("The URL is not an https:// URL on a public host", ErrorSchema),
          ...errorResponses,
          "429": response("Per-account endpoint limit reached", ErrorSchema),
        },
      },
    },
    "/webhooks/{id}": {
      patch: {
        summary: "Enable, disable, or rotate the secret of an endpoint",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { enabled: { type: "boolean" }, rotateSecret: { type: "boolean" } },
              },
            },
          },
        },
        responses: {
          "200": response("The endpoint; a rotation includes the new secret once", { type: "object", properties: { webhook: { oneOf: [WebhookSchema, WebhookCreatedSchema] } } }),
          "400": response("Neither enabled nor rotateSecret was sent", ErrorSchema),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
      delete: {
        summary: "Delete an endpoint",
        description: "Watchers delivering to it are paused; the response says how many.",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": response("Deleted", {
            type: "object",
            properties: { ok: { type: "boolean" }, pausedWatchers: { type: "integer" } },
          }),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
    },
    "/webhooks/{id}/test": {
      post: {
        summary: "Send a signed ping to an endpoint now",
        description:
          "Always HTTP 200: the endpoint's own answer is in the body as ok, status and error. Sent directly rather than through the delivery outbox, so a failure is not retried.",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "watchers:write",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": response("What the endpoint answered", {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              status: { type: ["integer", "null"] },
              error: { type: ["string", "null"] },
            },
          }),
          "400": response("The endpoint is disabled; enable it first", ErrorSchema),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
          "429": response("Too many test deliveries; Retry-After says when the window ends", ErrorSchema),
        },
      },
    },
    "/projects": {
      get: {
        summary: "List this account's projects",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "projects:read",
        responses: {
          "200": response("Projects", { type: "object", properties: { projects: { type: "array", items: ProjectSchema } } }),
          ...errorResponses,
        },
      },
    },
    "/builds/{id}": {
      get: {
        summary: "Get one build's status, contracts, and toolchain report",
        security: [{ bearerAuth: [] }],
        "x-required-scope": "builds:read",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": response("The build", BuildDetailSchema),
          "404": response("Not found", ErrorSchema),
          ...errorResponses,
        },
      },
    },
  },
  webhooks: {
    alert: {
      post: {
        summary: "A watcher alert posted to a registered endpoint",
        description:
          "Sent to the endpoint's url. X-Fletch-Event is `kind`; X-Fletch-Delivery is `id`; X-Fletch-Signature is `t=<unix seconds>,v1=<hex hmac-sha256 over \"<t>.<raw body>\">` keyed with the endpoint's secret. Answer 2xx within 10 seconds or it is retried, up to 8 attempts. The same `id` can arrive twice: use it as the idempotency key.",
        requestBody: { required: true, content: { "application/json": { schema: WebhookDeliverySchema } } },
        responses: { "2xx": { description: "Any 2xx marks the delivery sent" } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth },
    schemas: {
      PublicApp: PublicAppSchema,
      DirectoryToken: DirectoryTokenSchema,
      TokenMarket: TokenMarketSchema,
      ContractSearchMatch: ContractSearchMatchSchema,
      ContractSearchPage: ContractSearchPageSchema,
      ContractSearchResponse: ContractSearchResponseSchema,
      AppCatalogStatus: AppCatalogStatusSchema,
      AppCatalogPage: AppCatalogPageSchema,
      StockPairing: StockPairingSchema,
      StockPairingSummary: StockPairingSummarySchema,
      StockPairingPage: StockPairingPageSchema,
      StockTokenMembership: StockTokenMembershipSchema,
      MetricObservation: MetricObservationSchema,
      MarketSelection: MarketSelectionSchema,
      Error: ErrorSchema,
      Chain: ChainSchema,
      Asset: AssetSchema,
      AuthorityEvent: AuthorityEventSchema,
      Watcher: WatcherSchema,
      Run: RunSchema,
      Webhook: WebhookSchema,
      WebhookCreated: WebhookCreatedSchema,
      WebhookDelivery: WebhookDeliverySchema,
      Project: ProjectSchema,
    },
  },
  "x-scopes": API_KEY_SCOPES,
} as const;

// Every operation is grouped by what it is about, from its path, so Swagger UI
// and the written reference at /developers show the same sections.
export const API_TAGS: ReadonlyArray<{ name: string; description: string }> = [
  { name: "Apps", description: "Publicly listed creator apps and recorded token metadata. Owner controls and moderation remain in the dashboard." },
  { name: "Status", description: "Whether the registry is live and how old each figure is. Read this first when freshness matters." },
  { name: "Registry", description: "Recorded token identities and market observations with their sources, freshness and coverage: addresses, feeds, supply, holders, pools and history." },
  { name: "Changelog", description: "Every change the daemon noticed, as JSON with a cursor and as a live stream." },
  { name: "Chain", description: "The issuer's control plane, the token bridge, the issuer's paperwork, lookalike tokens, DEX venues and chain health." },
  { name: "Watch", description: "Watchers that alert on transfers and authority events, delivered to Telegram or a signed webhook. Needs a key." },
  { name: "Build", description: "Builds and projects. Needs a key." },
  { name: "Chains", description: "The networks Fletch knows." },
];

function tagFor(path: string): string {
  if (path === "/apps" || path.startsWith("/apps/")) return "Apps";
  if (path.endsWith("/status")) {
    return "Status";
  }
  if (path.includes("/events")) {
    return "Changelog";
  }
  if (path.includes("/assets")) {
    return "Registry";
  }
  if (/\/(control-plane|bridge|issuer|lookalikes|dex|health|corporate-actions)$/.test(path)) {
    return "Chain";
  }
  if (path.startsWith("/watchers") || path.startsWith("/webhooks")) {
    return "Watch";
  }
  if (path.startsWith("/builds") || path.startsWith("/projects")) {
    return "Build";
  }
  return "Chains";
}

type Operation = Record<string, unknown> & { tags?: string[] };
type PathItem = Record<string, Operation>;

function withTags<T extends { paths: Record<string, PathItem> }>(document: T): T & { tags: typeof API_TAGS } {
  const paths: Record<string, PathItem> = {};
  for (const [path, item] of Object.entries(document.paths)) {
    const tagged: PathItem = {};
    for (const [method, operation] of Object.entries(item)) {
      tagged[method] = { ...operation, tags: [tagFor(path)] };
    }
    paths[path] = tagged;
  }
  return { ...document, paths, tags: API_TAGS };
}

export const openApiDocument = withTags(untagged as unknown as { paths: Record<string, PathItem> } & typeof untagged);
