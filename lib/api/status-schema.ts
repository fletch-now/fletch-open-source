export const MetricCoverageSchema = {
  type: ["object", "null"],
  description: "Per-metric catalog coverage measured by the job, independent from scheduler health. Current and failed may overlap when a failed refresh retains a current observation. Age these counts from measuredAt; a fresh scheduler does not make older counts current.",
  additionalProperties: {
    type: "object", properties: {
      eligible: { type: "integer", minimum: 0 }, current: { type: "integer", minimum: 0 },
      failed: { type: "integer", minimum: 0 }, unread: { type: "integer", minimum: 0 },
      oldestInputAgeSeconds: { type: ["number", "null"], minimum: 0 }, measuredAt: { type: "string", format: "date-time" },
    }, required: ["eligible", "current", "failed", "unread", "oldestInputAgeSeconds", "measuredAt"],
  },
} as const;

const MetadataBacklogSchema = {
  type: ["object", "null"],
  description: "Metadata queue measured after this job's last successful batch. Null means no batch has reported coverage yet; a fresh batch does not imply complete token coverage.",
  properties: {
    total: { type: "integer", minimum: 0 },
    due: { type: "integer", minimum: 0 },
    visibleDue: { type: "integer", minimum: 0 },
    neverRead: { type: "integer", minimum: 0 },
    errors: { type: "integer", minimum: 0 },
    oldestCheckedAt: { type: ["string", "null"], format: "date-time" },
    measuredAt: { type: "string", format: "date-time" },
  },
  required: ["total", "due", "visibleDue", "neverRead", "errors", "oldestCheckedAt", "measuredAt"],
} as const;

export const SwapIndexerSchema = {
  type: "object",
  description: "Live swap tail and separate backwards backfill. Coverage is measured independently of daemon health. USDG uses a disclosed nominal dollar assumption; supported WETH windows use explicitly estimated historical oracle samples. Inspect valuation methods and valued-pool coverage.",
  properties: {
    mode: { const: "live_and_backwards" },
    checkedAt: { type: "string", format: "date-time" },
    newestCountedBlock: { type: ["string", "null"] },
    newestCountedAt: { type: ["string", "null"], format: "date-time" },
    headBlock: { type: ["string", "null"] },
    headReadAt: { type: ["string", "null"], format: "date-time" },
    lagBlocks: { type: ["string", "null"] },
    lagSeconds: { type: ["integer", "null"], minimum: 0, description: "Wall-clock age of the newest indexed block, independent of assumed block cadence." },
    windowStartAt: { type: ["string", "null"], format: "date-time" },
    windowEndAt: { type: ["string", "null"], format: "date-time" },
    current: { type: "boolean", description: "The indexed boundary is at most 120 seconds old; individual pools also require complete coverage." },
    historicalUsdAvailable: { type: "boolean", description: "True when complete current indexed pools include historical quote valuations; does not claim all pools are covered." },
    coverageScope: { const: "priority_pools" },
    tiersScope: { const: "canonical_catalog_pools" },
    catalogMeasuredAt: { type: ["string", "null"], format: "date-time", description: "Worker measurement time for the tier counts. Never replaced with the HTTP response time." },
    catalogStatus: { type: "string", enum: ["current", "stale", "unavailable"], description: "Catalog receipt is current for 120 seconds. Missing receipts return an empty tiers array, not measured zero counts. The live tail and selected-pool counts are read separately." },
    priorityPoolCount: { type: "integer", minimum: 0 },
    priorityComplete24hPools: { type: "integer", minimum: 0 },
    priorityValued24hPools: { type: "integer", minimum: 0 },
    valuationMethods: { type: "array", items: { type: "string", enum: ["usdg_nominal", "historical_chainlink_window_start"] } },
    tiers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tier: { type: "string", enum: ["active", "quiet", "dormant"] },
          totalPools: { type: "integer", minimum: 0 },
          enrolledPools: { type: "integer", minimum: 0 },
          complete24hPools: { type: "integer", minimum: 0 },
        },
        required: ["tier", "totalPools", "enrolledPools", "complete24hPools"],
      },
    },
  },
  required: ["mode", "checkedAt", "newestCountedBlock", "newestCountedAt", "headBlock", "headReadAt", "lagBlocks", "lagSeconds", "windowStartAt", "windowEndAt", "current", "historicalUsdAvailable", "tiers"],
} as const;

export const StatusSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["live", "degraded", "stale", "never"] },
    summary: { type: "string" },
    daemon: { type: "object" },
    head: { type: ["object", "null"] },
    swapIndexer: SwapIndexerSchema,
    lookalikes: {
      type: ["object", "null"],
      description: "Durable collision search and metadata backfill coverage. A successful bounded job does not mean every asset has complete coverage. Counts retain their own measuredAt timestamp.",
      properties: {
        measuredAt: { type: "string", format: "date-time" },
        assets: { type: "integer", minimum: 0 },
        completed: { type: "integer", minimum: 0 },
        pending: { type: "integer", minimum: 0 },
        failed: { type: "integer", minimum: 0 },
        oldestCompletedAt: { type: ["string", "null"], format: "date-time" },
        lastObservedAt: { type: ["string", "null"], format: "date-time" },
        localCompletedAt: { type: ["string", "null"], format: "date-time" },
        beaconPending: { type: "integer", minimum: 0 },
        beaconFailed: { type: "integer", minimum: 0 },
      },
      required: ["measuredAt", "assets", "completed", "pending", "failed", "oldestCompletedAt", "lastObservedAt", "localCompletedAt", "beaconPending", "beaconFailed"],
    },
    scouting: {
      type: ["object", "null"],
      description: "Catalog ticker candidates, bytecode evidence and unfinished pool coverage. A ticker match does not establish Robinhood app contract identity.",
      properties: {
        measuredAt: { type: "string", format: "date-time" },
        catalogSymbols: { type: "integer", minimum: 0 },
        receiptStatus: { type: "string", enum: ["current", "stale", "unavailable"] },
        matchedTickers: { type: "integer", minimum: 0 },
        bytecodeCheckedTickers: { type: "integer", minimum: 0 },
        unmatchedSymbols: { type: "array", items: { type: "string" } },
        pendingPoolTokens: { type: "integer", minimum: 0 },
        selectedPools: { type: "integer", minimum: 0 },
        completeVolumePools: { type: "integer", minimum: 0 },
        explorer: {
          type: "object",
          properties: {
            searchesCompleted: { type: "integer", minimum: 0 },
            searchesDue: { type: "integer", minimum: 0 },
            candidateContracts: { type: "integer", minimum: 0 },
            pendingContractChecks: { type: "integer", minimum: 0 },
            lastSearchAt: { type: ["string", "null"], format: "date-time" },
            provider: {
              type: ["object", "null"],
              properties: {
                observedAt: { type: "string", format: "date-time" },
                httpStatus: { type: "integer" },
                creditsAvailable: { type: ["boolean", "null"] },
                requestsPerSecond: { type: ["integer", "null"] },
              },
              required: ["observedAt", "httpStatus", "creditsAvailable", "requestsPerSecond"],
            },
          },
          required: ["searchesCompleted", "searchesDue", "candidateContracts", "pendingContractChecks", "lastSearchAt", "provider"],
        },
      },
      required: ["measuredAt", "catalogSymbols", "matchedTickers", "bytecodeCheckedTickers", "unmatchedSymbols", "pendingPoolTokens", "selectedPools", "completeVolumePools"],
    },
    jobs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          job: { type: "string" },
          cadenceSeconds: { type: "number" },
          verdict: { type: "string", enum: ["fresh", "late", "failing", "filling", "stalled", "never"] },
          metadataBacklog: MetadataBacklogSchema,
          metricCoverage: MetricCoverageSchema,
        },
        required: ["job", "cadenceSeconds", "verdict", "metadataBacklog", "metricCoverage"],
      },
    },
    figures: { type: "array", items: { type: "object" } },
  },
} as const;
