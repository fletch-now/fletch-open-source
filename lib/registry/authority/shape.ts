import { stateReadIsCurrent, positivePoolPrice } from "./dex-state-freshness";
import type { PoolTokenTrust } from "@/lib/registry/trust";
// The JSON an agent or a page receives. Numbers that are exact on chain stay
// strings (raw supply, wei); the rest are numbers. Every timestamp is ISO. The
// shape is stable: a field is added, never renamed, so a client written today
// keeps working.

import { SUPPLY_FRESH_MS, expiresAt, observationStatus, poolQuoteMetric } from "@/lib/registry/metric-observation";
import { marketCapUsd } from "@/lib/registry/authority/depth";
import type { DexPool, DexToken, VenueScan, VenueTotals } from "@/lib/registry/authority/dex";
import type { BridgeEscrowRow, BridgeFlow } from "@/lib/registry/authority/bridge";
import type { IssuerDocument, IssuerPage } from "@/lib/registry/authority/issuer";
import { VERDICT_MEANING, type Freshness } from "@/lib/registry/authority/freshness";
import type { StateDay } from "@/lib/registry/authority/state-daily";
import type { HolderLabel } from "@/lib/registry/authority/labels";
import type { ActivityDay, AssetState, AuthorityEvent, ChainHealthRow, Concentration, FeedRound, HolderRow, Lookalike, ControlEvent, ControlState, CorporateAction, MultiplierEvent, SupplyEvent, SupplySnapshot } from "@/lib/registry/authority/read";

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function num(value: string | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function seconds(ms: number | null): number | null {
  return ms === null ? null : Math.round(ms / 1000);
}

export function publicState(state: AssetState | null) {
  if (!state) {
    return null;
  }
  const dexCurrent = state.dexStateCurrent !== false && stateReadIsCurrent(state.dexCheckedAt);
  return {
    multiplier: num(state.uiMultiplier),
    pendingMultiplier: num(state.newUiMultiplier),
    multiplierEffectiveAt: iso(state.multiplierEffectiveAt),
    tokenPaused: state.tokenPaused,
    oraclePaused: state.oraclePaused,
    totalSupplyRaw: state.totalSupplyRaw,
    totalSupplyUi: state.totalSupplyUi,
    canonical: state.canonical,
    beacon: state.beaconAddress,
    implementation: state.implementationAddress,
    feed: state.feedAddress
      ? { address: state.feedAddress, price: num(state.feedPrice), updatedAt: iso(state.feedUpdatedAt), stale: state.feedStale }
      : null,
    quote: state.apiBid
      ? { bid: num(state.apiBid), ask: num(state.apiAsk), tradingHalt: state.apiTradingHalt, dailyVolume: num(state.apiDailyVolume), at: iso(state.apiCheckedAt) }
      : null,
    priceDivergencePct: num(state.priceDivergencePct),
    checkedAt: iso(state.stateCheckedAt),
    // The selected pool keeps its own depth method and observation time.
    dex: state.dexCheckedAt
      ? {
          poolId: state.dexPoolId,
          venue: state.dexVenue,
          priceUsd: dexCurrent ? num(state.dexPriceUsd) : null,
          depthUsd: dexCurrent ? num(state.dexDepthUsd) : null,
          depthMeasure: depthMeasure(state.dexVenue),
          liquidity: dexCurrent ? state.dexLiquidity : null,
          premiumPct: dexCurrent ? num(state.dexPremiumPct) : null,
          stateCurrent: dexCurrent,
          reason: dexCurrent ? null : "The pool state or its quote input is stale, unavailable or from a different snapshot.",
          at: iso(state.dexCheckedAt),
        }
      : null,
    // What a second indexer counts for the same contract, and whether its
    // total supply agrees with the contract's own answer above.
    secondSource: state.blockscoutCheckedAt
      ? {
          source: "blockscout",
          holders: state.blockscoutHolders,
          transfers: state.blockscoutTransfers === null ? null : state.blockscoutTransfers.toString(),
          totalSupplyRaw: state.blockscoutTotalSupplyRaw,
          supplyAgreement: state.supplyAgreement,
          at: iso(state.blockscoutCheckedAt),
        }
      : null,
  };
}

export function publicLookalike(row: Lookalike) {
  return {
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    holders: row.holders,
    totalSupplyRaw: row.totalSupplyRaw,
    claims: row.matchesSymbol,
    kind: row.kind,
    exactName: row.exactName,
    beacon: row.beacon,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
  };
}

export function publicControlState(state: ControlState | null) {
  if (!state) {
    return null;
  }
  return {
    registry: state.registryAddress,
    implementation: state.implementation,
    paused: state.paused,
    blockedAddresses: state.blockedCount,
    lastEventBlock: state.lastEventBlock?.toString() ?? null,
    checkedAt: iso(state.checkedAt),
  };
}

export function publicControlEvent(event: ControlEvent) {
  return {
    event: event.event,
    account: event.account,
    role: event.role,
    implementation: event.implementation,
    block: event.blockNumber.toString(),
    txHash: event.txHash,
    logIndex: event.logIndex,
  };
}

export function publicMultiplierEvent(event: MultiplierEvent) {
  return {
    from: num(event.oldMultiplier),
    to: num(event.newMultiplier),
    effectiveAt: iso(event.effectiveAt),
    block: event.blockNumber.toString(),
    txHash: event.txHash,
  };
}

export function publicSupplyEvent(event: SupplyEvent) {
  return {
    kind: event.kind,
    counterparty: event.counterparty,
    valueRaw: event.valueRaw,
    block: event.blockNumber.toString(),
    txHash: event.txHash,
  };
}

export function publicSupplySnapshot(snapshot: SupplySnapshot) {
  return {
    day: snapshot.day,
    totalSupplyRaw: snapshot.totalSupplyRaw,
    mintedRaw: snapshot.mintedRaw,
    burnedRaw: snapshot.burnedRaw,
    residualRaw: snapshot.residualRaw,
    headBlock: snapshot.headBlock.toString(),
  };
}

export function publicCorporateAction(action: CorporateAction) {
  return {
    id: action.id,
    symbol: action.symbol,
    kind: action.kind,
    status: action.status,
    processDate: action.processDate,
    rate: num(action.rate),
  };
}

export function publicHealth(row: ChainHealthRow | null) {
  if (!row) {
    return null;
  }
  return {
    headBlock: row.headBlock.toString(),
    blockTimeMs: row.blockTimeMs,
    baseFeeWei: row.baseFeeWei,
    l1Block: row.l1Block?.toString() ?? null,
    batchCount: row.batchCount?.toString() ?? null,
    delayedMessages: row.delayedMessages?.toString() ?? null,
    batchPosterBalanceWei: row.batchPosterBalanceWei,
    statusPage: row.statusPage,
    arbosVersion: row.arbosVersion,
    chainOwners: row.chainOwners,
    finality: row.latestConfirmedAssertion
      ? { latestConfirmedAssertion: row.latestConfirmedAssertion, confirmedAtL1Block: row.confirmedAtL1Block?.toString() ?? null, confirmedAgeSeconds: row.confirmedAgeSeconds }
      : null,
    checkedAt: iso(row.checkedAt),
  };
}

export function publicIssuerDocument(doc: IssuerDocument, symbols: Map<string, string>) {
  return {
    url: doc.url,
    title: doc.title,
    kind: doc.kind,
    underlying: doc.underlying,
    asset: doc.assetId ? (symbols.get(doc.assetId) ?? null) : null,
    etag: doc.etag,
    lastModified: iso(doc.lastModified),
    bytes: doc.bytes?.toString() ?? null,
    firstSeenAt: iso(doc.firstSeenAt),
    changedAt: iso(doc.changedAt),
    goneAt: iso(doc.goneAt),
  };
}

export function publicIssuerPage(page: IssuerPage) {
  return { page: page.slug, url: page.url, title: page.title, sha256: page.sha256, firstSeenAt: iso(page.firstSeenAt), changedAt: iso(page.changedAt), lastSeenAt: iso(page.lastSeenAt) };
}

// One changelog entry. `observedAt` is when Fletch recorded it and is the
// cursor; `occurredAt` is the block time when the event came from a log.
export function publicAuthorityEvent(event: AuthorityEvent) {
  return {
    id: event.id,
    kind: event.kind,
    title: event.title,
    symbol: event.symbol,
    address: event.address,
    detail: event.detail,
    block: event.blockNumber === null ? null : event.blockNumber.toString(),
    txHash: event.txHash,
    occurredAt: event.occurredAt.toISOString(),
    observedAt: event.observedAt.toISOString(),
  };
}

export function publicFeedRound(round: FeedRound) {
  return {
    roundId: round.roundId,
    answer: num(round.answer),
    startedAt: iso(round.startedAt),
    updatedAt: iso(round.updatedAt),
  };
}

// `sits` names the concentration share this balance counts towards and is
// always one of the six: `unknown` is an address the code probe has not checked
// yet, which is a different thing from a wallet it checked and found to have no
// code. `label` and `labelKind` are null for an address the registry has
// nothing to say about beyond that.
export function publicHolder(row: HolderRow, totalSupplyRaw: string | null, label: HolderLabel | null) {
  const balance = row.rawBalance.split(".")[0];
  const total = totalSupplyRaw ? BigInt(totalSupplyRaw) : BigInt(0);
  return {
    holder: row.holder,
    rawBalance: balance,
    sharePct: total > BigInt(0) ? Number((BigInt(balance) * BigInt(1_000_000)) / total) / 10_000 : null,
    asOfBlock: row.updatedBlock.toString(),
    label: label?.label ?? null,
    labelKind: label?.kind ?? null,
    sits: label ? label.bucket : "unknown",
  };
}

// `shares` is where the supply sits: the six add to 100. `unknownPct` is the
// share held by addresses the code probe has not checked — it checks every
// holder above a ten-thousandth of supply, so the tail below that stays here
// and a float share is a floor rather than a final answer.
export function publicConcentration(row: Concentration | null) {
  if (!row) {
    return null;
  }
  return {
    day: row.day,
    holders: row.holders,
    top1Pct: num(row.top1Pct),
    top10Pct: num(row.top10Pct),
    gini: num(row.gini),
    issuerPct: num(row.issuerPct),
    issuerAddress: row.issuerAddress,
    poolsPct: num(row.poolsPct),
    bridgePct: num(row.bridgePct),
    contractsPct: num(row.contractsPct),
    unknownPct: num(row.unknownPct),
    floatPct: num(row.floatPct),
    asOfBlock: row.headBlock.toString(),
    takenAt: iso(row.takenAt),
  };
}

// One past day for one asset: the same numbers publicState carries, flattened,
// as they stood when the daily job last ran that day. A null is "not read that
// day", never zero, and each `...CheckedAt` says when the figures beside it
// were last read, so a caller can see how old the reading was.
//
// The flat names map onto the live nested `state` block, and must keep doing
// so: feedPrice/feedStale are state.feed.price/.stale, bid/ask/tradingHalt are
// state.quote.bid/.ask/.tradingHalt, dexPriceUsd/dexPremiumPct/dexLiquidity are
// state.dex.priceUsd/.premiumPct/.liquidity, blockscoutHolders is
// state.secondSource.holders, and multiplier is state.multiplier.
export function publicStateDay(row: StateDay) {
  return {
    day: row.day,
    multiplier: num(row.uiMultiplier),
    tokenPaused: row.tokenPaused,
    oraclePaused: row.oraclePaused,
    tradingHalt: row.apiTradingHalt,
    feedPrice: num(row.feedPrice),
    feedStale: row.feedStale,
    bid: num(row.apiBid),
    ask: num(row.apiAsk),
    priceDivergencePct: num(row.priceDivergencePct),
    dexPriceUsd: num(row.dexPriceUsd),
    dexPremiumPct: num(row.dexPremiumPct),
    dexLiquidity: row.dexLiquidity,
    totalSupplyRaw: row.totalSupplyRaw,
    blockscoutHolders: row.blockscoutHolders,
    ledgerHolders: row.ledgerHolders,
    lookalikes: row.lookalikes,
    stateCheckedAt: iso(row.stateCheckedAt),
    feedCheckedAt: iso(row.feedCheckedAt),
    apiCheckedAt: iso(row.apiCheckedAt),
    dexCheckedAt: iso(row.dexCheckedAt),
    blockscoutCheckedAt: iso(row.blockscoutCheckedAt),
    takenAt: iso(row.takenAt),
  };
}

// The keys `?fields=` accepts. Written out rather than derived from a sample
// row so the compiler rejects a key that publicStateDay does not return and a
// key it returns that is missing here; a field left out of this list would be
// a 400 on a name the API does in fact serve.
const STATE_DAY_FIELD_SET: Record<keyof ReturnType<typeof publicStateDay>, true> = {
  day: true,
  multiplier: true,
  tokenPaused: true,
  oraclePaused: true,
  tradingHalt: true,
  feedPrice: true,
  feedStale: true,
  bid: true,
  ask: true,
  priceDivergencePct: true,
  dexPriceUsd: true,
  dexPremiumPct: true,
  dexLiquidity: true,
  totalSupplyRaw: true,
  blockscoutHolders: true,
  ledgerHolders: true,
  lookalikes: true,
  stateCheckedAt: true,
  feedCheckedAt: true,
  apiCheckedAt: true,
  dexCheckedAt: true,
  blockscoutCheckedAt: true,
  takenAt: true,
};

export const STATE_DAY_FIELDS = Object.keys(STATE_DAY_FIELD_SET);

export function publicActivityDay(row: ActivityDay) {
  return {
    day: row.day,
    transfers: row.transfers,
    volumeRaw: row.volumeRaw.split(".")[0],
    mints: row.mints,
    burns: row.burns,
    dvpTransfers: row.dvpTransfers,
    offhoursTransfers: row.offhoursTransfers,
  };
}

// The unlisted side of a community pool, as its contract describes it. FDV is
// supply times the pool's dollar price, the only market-cap figure a token
// with no issuer can have, and it is null until both are read.
export function publicToken(token: DexToken | undefined, priceUsd: number | null, now = Date.now()) {
  if (!token) {
    return null;
  }
  const supplyAt = iso(token.supplyCheckedAt);
  const supplyExpiry = expiresAt(supplyAt, SUPPLY_FRESH_MS);
  const supplyCurrent = observationStatus(supplyAt, supplyExpiry, now) === "current";
  const supply = supplyCurrent && token.totalSupplyRaw !== null && token.decimals !== null ? Number(token.totalSupplyRaw) / 10 ** token.decimals : null;
  return {
    address: token.address,
    symbol: token.symbol,
    name: token.name,
    decimals: token.decimals,
    totalSupplyRaw: token.totalSupplyRaw,
    fdvUsd: supply !== null && priceUsd !== null ? supply * priceUsd : null,
    // Supply minus the burn addresses, priced from this pool. Circulating
    // supply is not knowable on chain, so this is a ceiling on it and the
    // field is null unless supply, burn and decimals were all read.
    burnedRaw: token.burnedRaw,
    marketCapUsd: supplyCurrent ? marketCapUsd(token, priceUsd) : null,
    supplyReadAt: supplyAt, supplyExpiresAt: supplyExpiry, supplyCurrent,
    readAt: iso(token.checkedAt),
  };
}

// A pool too shallow for its price to mean anything. Everything derived from
// that price — the price itself, the change windows, FDV, market cap — is left
// out rather than printed, because a sixty-dollar pool can be made to say any
// number at all.
function poolStateIsCurrent(pool: DexPool, now: number): boolean {
  if (pool.stateObservationCurrent === false || !stateReadIsCurrent(pool.stateCheckedAt, now)) return false;
  if (!pool.quoteObservation) return true;
  const quote = poolQuoteMetric(pool.quoteObservation, iso(pool.stateCheckedAt), null, now);
  return quote.value !== null && quote.observation.status === "current" && quote.reason === null;
}

export function pricingIsMeaningful(pool: DexPool, floorUsd: number, now = Date.now()): boolean {
  const depth = num(pool.depthUsd);
  return poolStateIsCurrent(pool, now) && depth !== null && Number.isFinite(depth) && depth >= floorUsd
    && (positivePoolPrice(pool.priceUsd) !== null || positivePoolPrice(pool.priceInQuote) !== null);
}

export function depthMeasure(venue: string | null): "quote_holdings" | "bounded_one_percent_quote" | "unavailable" {
  if (venue === "uniswap_v3") return "quote_holdings";
  if (venue === "uniswap_v4") return "bounded_one_percent_quote";
  return "unavailable";
}

export function publicPool(pool: DexPool, symbols: Map<string, string>, tokens?: Map<string, DexToken>, floorUsd = 0, now = Date.now(), identity?: PoolTokenTrust) {
  const metricAge = pool.metricsAsOf ? now - pool.metricsAsOf.getTime() : Infinity;
  if (!pool.metricsCoverageComplete || !pool.metricsCurrent || metricAge < 0 || metricAge > 120_000) {
    pool = { ...pool, swaps24h: null, transactions24h: null, volumeUsd24h: null, metricsAsOf: null,
      metricsCurrent: false, volume0Raw: null, volume1Raw: null };
  }
  const stateCurrent = poolStateIsCurrent(pool, now);
  const priced = pricingIsMeaningful(pool, floorUsd, now);
  return {
    poolId: pool.id,
    venue: pool.venue,
    kind: identity?.level ?? "unknown",
    trust: identity?.level ?? "unknown",
    trustDetail: identity?.detail ?? "The priced token address has not been resolved.",
    tokenAddress: identity?.address ?? pool.tokenAddress,
    listing: pool.assetId ? "listed" : "unlisted",
    // active: read every ten minutes, priced every five. quiet: a little
    // depth and no recent swap, read daily. dormant: drained or empty for a
    // month, read weekly and out of the default view.
    tier: pool.tier,
    lastSwapAt: iso(pool.lastSwapAt),
    token: pool.tokenAddress ? publicToken(tokens?.get(pool.tokenAddress), priced ? positivePoolPrice(pool.priceUsd) : null, now) : null,
    // Null on Uniswap v4, where a pool is an id inside the PoolManager.
    poolAddress: pool.poolAddress,
    currency0: pool.currency0,
    currency1: pool.currency1,
    fee: pool.fee,
    // Uniswap v4 marks a dynamic-fee pool with bit 23 of `fee`; the number is
    // a flag then, not a rate.
    feeDynamic: (pool.fee & 0x800000) !== 0,
    feePct: (pool.fee & 0x800000) !== 0 ? null : pool.fee / 10_000,
    tickSpacing: pool.tickSpacing,
    hooks: pool.hooks,
    asset: pool.assetId ? (symbols.get(pool.assetId) ?? null) : null,
    quote: pool.quoteAssetId ? (symbols.get(pool.quoteAssetId) ?? null) : null,
    createdBlock: pool.createdBlock.toString(),
    sqrtPriceX96: stateCurrent ? pool.sqrtPriceX96 : null,
    tick: stateCurrent ? pool.tick : null,
    // Raw in-range liquidity is comparable only for the same pair.
    liquidity: stateCurrent ? pool.liquidity : null,
    depthUsd: stateCurrent ? num(pool.depthUsd) : null,
    depthMeasure: depthMeasure(pool.venue),
    depthSource: pool.venue === "uniswap_v3" ? "quote balanceOf(pool)" : "in-range liquidity and price, bounded by PoolManager holdings",
    priceInQuote: priced ? positivePoolPrice(pool.priceInQuote) : null,
    priceUsd: priced ? positivePoolPrice(pool.priceUsd) : null,
    // Prices need a current state observation and sufficient measured depth.
    stateCurrent,
    quoteObservation: pool.quoteObservation ?? null,
    pricePublished: priced,
    // Null until the pool has been on record for the whole window: the swap
    // scan never read the blocks before the pool was discovered.
    swaps24h: pool.swaps24h,
    transactions24h: pool.transactions24h,
    metricsAsOf: iso(pool.metricsAsOf),
    metricsWindowStartAt: iso(pool.metricsWindowStartAt ?? null),
    metricsCoverageComplete: pool.metricsCoverageComplete ?? false,
    metricsCurrent: pool.metricsCurrent ?? false,
    volume0Raw: pool.volume0Raw ?? null,
    volume1Raw: pool.volume1Raw ?? null,
    priceSource: "dex" as const,
    volumeUsd24h: num(pool.volumeUsd24h),
    volumeValuation: pool.volumeValuation ?? null,
    stateCheckedAt: iso(pool.stateCheckedAt),
  };
}

export function publicVenueTotals(row: VenueTotals) {
  return {
    venue: row.venue,
    pools: row.pools,
    pricedPools: row.priced,
    depthUsd: row.depthUsd,
    swaps24h: row.swaps24h,
    volumeUsd24h: row.volumeUsd24h,
    assetsPricedHere: row.assetsPriced,
    checkedAt: iso(row.checkedAt),
  };
}

export function publicVenueScan(scan: VenueScan) {
  return {
    venue: scan.venue,
    scanned: scan.scanned,
    scannedToBlock: scan.block === null ? null : scan.block.toString(),
    headBlock: scan.head === null ? null : scan.head.toString(),
    headAt: iso(scan.headAt),
    blocksBehind: scan.behind === null ? null : scan.behind.toString(),
    readingHistory: scan.filling,
  };
}

export function publicBridgeFlow(flow: BridgeFlow, symbols: Map<string, string>) {
  return {
    direction: flow.direction,
    asset: flow.assetId ? (symbols.get(flow.assetId) ?? null) : null,
    l1Token: flow.l1Token,
    from: flow.fromAddress,
    to: flow.toAddress,
    amountRaw: flow.amountRaw.split(".")[0],
    l2ToL1Id: flow.l2ToL1Id,
    block: flow.blockNumber.toString(),
    txHash: flow.txHash,
    occurredAt: iso(flow.occurredAt),
    claimableAt: iso(flow.claimableAt),
  };
}

export function publicEscrow(row: BridgeEscrowRow, symbols: Map<string, string>) {
  return {
    asset: symbols.get(row.assetId) ?? null,
    l1Token: row.l1Token,
    l1Gateway: row.l1Gateway,
    escrowRaw: row.escrowRaw.split(".")[0],
    l2SupplyRaw: row.l2SupplyRaw?.split(".")[0] ?? null,
    inFlightRaw: row.inFlightRaw?.split(".")[0] ?? null,
    checkedAt: iso(row.checkedAt),
  };
}

function hours(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

export function publicFreshness(reading: Freshness) {
  return {
    chainId: reading.chainId,
    swapIndexer: reading.swapIndexer,
    scouting: reading.scouting ?? null,
    lookalikes: reading.lookalikes ?? null,
    checkedAt: iso(reading.checkedAt),
    verdict: reading.verdict,
    summary: reading.summary,
    daemon: {
      name: reading.daemon.name,
      alive: reading.daemon.alive,
      lastBeatAt: iso(reading.daemon.lastBeatAt),
      ageSeconds: seconds(reading.daemon.ageMs),
      jobsReported: reading.daemon.jobsReported,
      failing: reading.daemon.failing,
    },
    head: reading.head ? { block: reading.head.block.toString(), readAt: iso(reading.head.readAt), ageSeconds: seconds(reading.head.ageMs) } : null,
    jobs: reading.jobs.map(function publicJob(job) {
      return {
        job: job.job,
        cadenceSeconds: job.cadenceMs / 1000,
        verdict: job.verdict,
        lastRunAt: iso(job.lastRunAt),
        lastOkAt: iso(job.lastOkAt),
        ageSeconds: seconds(job.ageMs),
        rows: job.rows,
        error: job.error,
        running: job.running,
        metadataBacklog: job.metadataBacklog ?? null,
        metricCoverage: job.metricCoverage ?? null,
        checkpoints: job.checkpoints.map(function publicCheckpoint(point) {
          return {
            name: point.name,
            block: point.block.toString(),
            head: point.head?.toString() ?? null,
            behind: point.behind?.toString() ?? null,
            updatedAt: iso(point.updatedAt),
            blocksPerHour: point.blocksPerHour === null ? null : Math.round(point.blocksPerHour),
            hoursLeft: hours(point.hoursLeft),
          };
        }),
      };
    }),
    figures: reading.figures.map(function publicFigure(figure) {
      return {
        figure: figure.figure,
        what: figure.what,
        job: figure.job,
        cadenceSeconds: figure.cadenceMs / 1000,
        verdict: figure.verdict,
        newestAt: iso(figure.newestAt),
        ageSeconds: seconds(figure.ageMs),
        count: figure.count,
        unit: figure.unit,
      };
    }),
    verdicts: VERDICT_MEANING,
  };
}
