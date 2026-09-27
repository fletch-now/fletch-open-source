import Form from "next/form";
import { RegistryPageIntro } from "@/components/registry/page-intro";
import { ActiveFilter } from "@/components/registry/filter-bar";
import { FilterMenu } from "@/components/registry/filter-menu";
import { TableShell } from "@/components/registry/table-shell";
import { TokenMetric } from "@/components/registry/token-metric";
import { RegistryPagination, readPage } from "@/components/registry/pagination";
import { headers } from "next/headers";
import { clientIp } from "@/lib/ratelimit";
import { enqueueMarketSearch } from "@/lib/registry/authority/market-refresh";
import { readSwapIndexer } from "@/lib/registry/authority/market-swap-status";
import { SwapIndexerPanel } from "@/components/registry/swap-indexer-reading";
import { swapCoverageNote } from "@/components/registry/swap-indexer-format";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { stateReadIsCurrent } from "@/lib/registry/authority/dex-state-freshness";
import { publicReadCache } from "@/lib/public-cache";
import { MarketLink } from "@/components/registry/market-link";
import { Fragment } from "react";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { InfoTip } from "@/components/registry/info-tip";
import { REGISTRY_TERMS } from "@/components/registry/terms";
import { TrustBadge } from "@/components/registry/trust-badge";
import { RH_MAINNET_ID } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { listAssets } from "@/lib/registry/assets";
import { discoveryFloorUsd, priceFloorUsd } from "@/lib/admin/settings";
import { dexPoolsPage, poolChanges, poolKindCounts, searchShapeOf, symbolCluster, venueScans, venueTotals, type DexPool, type DexToken, type PoolChanges, type PoolKind, type PoolSort, type PoolTierFilter } from "@/lib/registry/authority/dex";
import { venueTitle } from "@/lib/registry/authority/constants";
import { pricingIsMeaningful } from "@/lib/registry/authority/shape";
import { marketCapUsd } from "@/lib/registry/authority/depth";
import { lastRunOf } from "@/lib/registry/authority/runs";
import { trustForTokens } from "@/lib/registry/trust";
import type { TrustLevel } from "@/lib/registry/trust-rules";
import { ago, shortHex } from "@/components/registry/format";

// Uniswap v4 spends native ETH directly, and addresses it as the zero address.
const NATIVE_CURRENCY = "0x0000000000000000000000000000000000000000";
const KINDS: Array<{ key: PoolKind; label: string; hint: string }> = [
  { key: "all", label: "All pairs", hint: "Every pool on record" },
  { key: "listed", label: "Listed", hint: "One side is on Robinhood's list; each row shows whether its contract has been confirmed" },
  { key: "community", label: "Community", hint: "The priced side is a token the list does not carry, described only by its own contract" },
  { key: "lookalike", label: "Lookalikes", hint: "The priced side has a matching listed ticker or name at another address" },
];
const SORTS: Array<{ key: PoolSort; label: string }> = [
  { key: "traction", label: "Traction" },
  { key: "depth", label: "Deepest" },
  { key: "volume", label: "Volume" },
  { key: "swaps", label: "Swaps" },
  { key: "newest", label: "Newest pools" },
];

function pickKind(raw: unknown): PoolKind {
  return typeof raw === "string" && KINDS.some((kind) => kind.key === raw) ? (raw as PoolKind) : "all";
}

function pickSort(raw: unknown): PoolSort {
  return typeof raw === "string" && SORTS.some((sort) => sort.key === raw) ? (raw as PoolSort) : "volume";
}

const TIERS: Array<{ key: PoolTierFilter; label: string; hint: string }> = [
  { key: "active", label: "Active", hint: "Pools assigned to the active read queue" },
  { key: "quiet", label: "Quiet", hint: "Pools assigned to the quiet read queue" },
  { key: "dormant", label: "Dormant", hint: "Pools assigned to the dormant read queue" },
  { key: "all", label: "All recorded pools", hint: "All canonical pool discoveries, including unread pools and hidden tokens" },
];

function defaultTier(sort: PoolSort): PoolTierFilter {
  return sort === "newest" ? "all" : "active";
}

function pickTier(raw: unknown, sort: PoolSort): PoolTierFilter {
  return typeof raw === "string" && TIERS.some((tier) => tier.key === raw) ? (raw as PoolTierFilter) : defaultTier(sort);
}

function usdText(value: string | number | null): string {
  if (value === null) {
    return "—";
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return "—";
  }
  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

function changeCell(value: number | null) {
  if (value === null) {
    return <span className="text-ink-faint">—</span>;
  }
  const tone = value > 0 ? "text-hood-deep" : value < 0 ? "text-red-700" : "text-ink-soft";
  return <span className={tone}>{`${value > 0 ? "+" : ""}${value.toFixed(2)}%`}</span>;
}

// Uniswap v4 marks a dynamic-fee pool with bit 23; the number is a flag then,
// not a rate.
function feeText(fee: number): string {
  return (fee & 0x800000) !== 0 ? "dynamic fee" : `${(fee / 10_000).toFixed(2)}%`;
}

function fdvOf(pool: DexPool, token: DexToken | undefined): number | null {
  if (!token || token.totalSupplyRaw === null || token.decimals === null || pool.priceUsd === null) {
    return null;
  }
  return (Number(token.totalSupplyRaw) / 10 ** token.decimals) * Number(pool.priceUsd);
}

function pairText(pool: DexPool, symbols: Map<string, string>, token: DexToken | undefined): { base: string; name: string | null; quote: string } {
  const quote = pool.quoteAssetId ? (symbols.get(pool.quoteAssetId) ?? "?") : "?";
  if (pool.assetId) {
    return { base: symbols.get(pool.assetId) ?? "?", name: null, quote };
  }
  // Currency zero on Uniswap v4 is native ETH, not a token nobody has read.
  if (pool.tokenAddress === NATIVE_CURRENCY) {
    return { base: "ETH", name: "Ether", quote };
  }
  return { base: token?.symbol ?? shortHex(pool.tokenAddress ?? "", 6, 4), name: token?.name ?? null, quote };
}

function missText(q: string, shape: ReturnType<typeof searchShapeOf>, kind: PoolKind, tier: PoolTierFilter): string {
  // A pasted address ignores the tier and the floor, so a miss on one is a
  // statement about the whole record, not about the current view.
  if (q && shape === "address") {
    return "No token contract and no Uniswap v3 pool on record has this address. Discovery may not have reached it yet; a v4 pool is a 32-byte id, not an address.";
  }
  if (q && shape === "poolId") {
    return "No Uniswap v4 pool on record has this id.";
  }
  if (q) {
    return "No listed ticker and no token symbol or name on record starts with that.";
  }
  if (kind !== "all" || tier !== "active") {
    return "Nothing matches that filter yet.";
  }
  return "No active pools on record yet; discovery has not reached them.";
}

function hrefFor(kind: PoolKind, sort: PoolSort, q: string, page: number, tier: PoolTierFilter = defaultTier(sort), pageSize: 25 | 50 = 25, explicitTier = false): string {
  const params = new URLSearchParams({ view: "pools" });
  if (pageSize === 50) params.set("size", "50");
  if (kind !== "all") {
    params.set("kind", kind);
  }
  if (explicitTier || tier !== defaultTier(sort)) {
    params.set("tier", tier);
  }
  if (sort !== "volume") {
    params.set("sort", sort);
  }
  if (q) {
    params.set("q", q);
  }
  if (page > 1) {
    params.set("page", String(page));
  }
  const query = params.toString();
  return query ? `/registry/markets?${query}` : "/registry/markets";
}

async function readOverview() {
  return Promise.all([
    poolKindCounts(RH_MAINNET_ID), venueTotals(RH_MAINNET_ID), venueScans(RH_MAINNET_ID),
    lastRunOf("dex-state"), lastRunOf("dex-prices"), readSwapIndexer(RH_MAINNET_ID),
  ]);
}

const cachedOverview = publicReadCache<Awaited<ReturnType<typeof readOverview>>>(15_000, 1);

export async function PoolMarkets({ searchParams }: PageProps<"/registry/markets">) {
  const params = await searchParams;
  const kind = pickKind(params.kind ?? params.trust);
  const sort = pickSort(params.sort);
  const tier = pickTier(params.tier, sort);
  const explicitTier = typeof params.tier === "string" && TIERS.some((entry) => entry.key === params.tier);
  const q = typeof params.q === "string" ? params.q.trim().replace(/^\$/, "").slice(0, 128) : "";
  const pagination = readPage(params);
  const page = pagination.page;
  const PAGE = pagination.pageSize;
  if (q) await enqueueMarketSearch(RH_MAINNET_ID, q, clientIp(await headers()));
  const [all, floorUsd, priceFloor] = await Promise.all([listAssets(RH_MAINNET_ID), discoveryFloorUsd(), priceFloorUsd()]);
  const symbols = new Map(all.map((asset) => [asset.id, asset.symbol]));
  async function listedIdsFor(ticker: string): Promise<string[]> {
    return all.filter((asset) => asset.symbol.toUpperCase() === ticker).map((asset) => asset.id);
  }
  const [result, overview, cluster] = await Promise.all([
    dexPoolsPage({ chainId: RH_MAINNET_ID, limit: PAGE, offset: (page - 1) * PAGE, kind, tier, sort, venue: null, q: q || null, floorUsd }, listedIdsFor),
    cachedOverview(String(RH_MAINNET_ID), readOverview),
    q ? symbolCluster(RH_MAINNET_ID, q) : Promise.resolve(null),
  ]);
  const [counts, totals, scans, stateRun, sampleRun, swaps] = overview;
  const addressById = new Map(all.map((asset) => [asset.id, asset.address]));
  function pricedSideOf(pool: DexPool): string | null {
    return pool.assetId ? (addressById.get(pool.assetId) ?? null) : pool.tokenAddress;
  }
  // One verdict per row, from the one trust function: a community token whose
  // symbol imitates a listed one is a lookalike in this table too, not merely
  // "unverified".
  const [changes, trust] = await Promise.all([
    poolChanges(result.pools),
    trustForTokens(RH_MAINNET_ID, result.pools.map(pricedSideOf).filter((address): address is string => address !== null)),
  ]);
  const empty: PoolChanges = { change5mPct: null, change1hPct: null, change6hPct: null, change24hPct: null };
  const swaps24h = totals.some((venue) => venue.swaps24h === null) ? null : totals.reduce((sum, venue) => sum + (venue.swaps24h ?? 0), 0);
  const volume24h = totals.some((venue) => venue.volumeUsd24h === null) ? null : totals.reduce((sum, venue) => sum + (venue.volumeUsd24h ?? 0), 0);
  const filling = scans.some((scan) => scan.filling);
  // A miss says what was looked at, so a pasted address that finds nothing is
  // an answer rather than a shrug.
  const searchShape = q ? searchShapeOf(q) : "text";
  // The rows are already in traction order, so the first row's token is the one
  // with the most behind it. The notice goes where its pools stop, which is the
  // point a reader would otherwise assume the rest are the same token.
  const leaderToken = cluster ? (result.pools[0]?.tokenAddress ?? null) : null;
  const clusterBreakAt = leaderToken === null ? -1 : result.pools.findIndex((pool) => pool.tokenAddress !== leaderToken);
  const emptyText = missText(q, searchShape, kind, tier);
  const swapNote = swapCoverageNote(swaps);

  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Individual pools" actions={<><Link href="/registry/markets">Token markets</Link><a href={`/api/v1/chains/${RH_MAINNET_ID}/dex/pools?${new URLSearchParams({q, kind, tier, sort, limit: String(PAGE), offset: String((page - 1) * PAGE)})}`}>JSON</a><RefreshReading /></>}>Compare trading pools, fees and recorded activity. A token can have several pools.</RegistryPageIntro>
        <Form scroll={false} action="/registry/markets" className="mt-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="view" value="pools" />
          {pagination.pageSize === 50 ? <input type="hidden" name="size" value="50" /> : null}
          <label className="sr-only" htmlFor="markets-q">
            Ticker or token
          </label>
          <input
            key={q}
            id="markets-q"
            name="q"
            defaultValue={q}
            placeholder="Ticker, token address or pool ID"
            className="h-10 min-w-0 flex-1 sm:max-w-md rounded-lg border border-line bg-raised px-4 font-mono text-[13px] text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-line-strong focus:outline-none"
          />
          {kind !== "all" ? <input type="hidden" name="kind" value={kind} /> : null}
          {explicitTier || tier !== defaultTier(sort) ? <input type="hidden" name="tier" value={tier} /> : null}
          {sort !== "volume" ? <input type="hidden" name="sort" value={sort} /> : null}
          <button type="submit" className="h-10 rounded-lg bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90">
            Search
          </button>
          {q ? (
            <MarketLink href={hrefFor(kind, sort, "", 1, tier, pagination.pageSize, explicitTier)} className="text-[13px] text-ink-soft underline-offset-4 hover:underline">
              Clear
            </MarketLink>
          ) : null}
          <span className="ml-auto font-mono text-[12px] text-ink-faint">
            {result.total.toLocaleString("en-US")} pairs{q ? ` for ${q}` : ""}
            {q && searchShape !== "text" ? <span className="ml-2 text-ink-soft">every tier searched</span> : null}
          </span>
        </Form>
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Pool market filters">
          <FilterMenu label="Pairs" value={KINDS.find((entry) => entry.key === kind)!.label} options={KINDS.map(function kindOption(entry) {
            return { label: entry.label, description: entry.hint, href: hrefFor(entry.key, sort, q, 1, tier, PAGE, explicitTier), active: entry.key === kind };
          })} />
          {searchShape === "text" ? <FilterMenu label="Tier" value={TIERS.find((entry) => entry.key === tier)!.label} options={TIERS.map(function tierOption(entry) {
            const description = entry.key === "all" ? entry.hint : `${entry.hint}. Requires current pool state and at least ${usdText(floorUsd)} of recorded quote value.`;
            return { label: entry.label, description, href: hrefFor(kind, sort, q, 1, entry.key, PAGE, true), active: entry.key === tier };
          })} /> : <span className="rounded-lg border border-line px-3 py-2 text-[14px] text-ink">All tiers · exact address or pool ID</span>}
          <FilterMenu label="Sort" value={SORTS.find((entry) => entry.key === sort)!.label} options={SORTS.map(function sortOption(entry) {
            const nextTier = explicitTier ? tier : defaultTier(entry.key);
            return { label: entry.label, href: hrefFor(kind, entry.key, q, 1, nextTier, PAGE, explicitTier), active: entry.key === sort };
          })} />
          <Link href={hrefFor(kind, "newest", q, 1, "all", PAGE)} className="inline-flex min-h-11 items-center px-2 text-[13px] underline underline-offset-4">Newest pools across all tiers</Link>
        </div>
        {sort === "newest" ? <p className="mt-2 text-[13px] leading-5 text-ink-soft">Ordered by pool creation block. Recorded age is when Fletch first indexed the pool; it does not date a token launch. {tier === "all" || searchShape !== "text" ? "New pools remain visible while metadata and market readings are pending." : "This tier requires current pool readings and the quote-value minimum; newer unread pools are excluded."}</p> : null}
        {q || kind !== "all" || tier !== defaultTier(sort) || sort !== "volume" ? <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
          {q ? <ActiveFilter label={`Search: ${q}`} href={hrefFor(kind, sort, "", 1, tier, PAGE, explicitTier)} /> : null}
          {kind !== "all" ? <ActiveFilter label={`Pairs: ${KINDS.find((entry) => entry.key === kind)!.label}`} href={hrefFor("all", sort, q, 1, tier, PAGE, explicitTier)} /> : null}
          {tier !== defaultTier(sort) && searchShape === "text" ? <ActiveFilter label={`Tier: ${TIERS.find((entry) => entry.key === tier)!.label}`} href={hrefFor(kind, sort, q, 1, defaultTier(sort), PAGE)} /> : null}
          {sort !== "volume" ? <ActiveFilter label={`Sort: ${SORTS.find((entry) => entry.key === sort)!.label}`} href={hrefFor(kind, "volume", q, 1, tier, PAGE, explicitTier)} /> : null}
          <Link href={hrefFor("all", "volume", "", 1, "active", PAGE)} className="px-2 py-1.5 text-[13px] text-ink underline underline-offset-4">Reset all</Link>
        </div> : null}

        {(sort === "volume" || sort === "swaps" || sort === "traction") && result.pools.length > 0 && result.pools.every((pool) => sort === "swaps" ? pool.swaps24h === null : pool.volumeUsd24h === null) ? (
          <p role="status" className="mt-4 text-[13px] text-ink-soft">
            {sort === "swaps" ? "Swap counts" : "Volume figures"} are unavailable for these pools. Missing values remain blank; volume order does not substitute liquidity measurements.
          </p>
        ) : null}

        <RegistryPagination basePath="/registry/markets" params={{ ...params, view: "pools" }} page={page} pageSize={PAGE} total={result.total} compact />

        {result.pools.length === 0 ? (
          <p className="mt-6 rounded-card border border-dashed border-line bg-panel/40 px-5 py-8 text-[14px] text-ink-soft">{emptyText}</p>
        ) : (
          <TableShell label="Pool markets" className="mt-1">
            <table className="w-full min-w-[1180px] text-left text-[13.5px]">
              <thead>
                <tr className="border-b border-line bg-panel/40 text-ink-soft">
                  <th className="mono-label px-4 py-3 font-normal">pair</th>
                  <th className="mono-label px-3 py-3 font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      status
                      <InfoTip label="About pool identity" text={REGISTRY_TERMS.identity} />
                    </span>
                  </th>
                  <th className="mono-label px-3 py-3 font-normal">venue</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium"><span className="inline-flex items-center gap-1">price<InfoTip label="About pool price" text={REGISTRY_TERMS.dexPrice} align="end" /></span></th>
                  <th className="mono-label px-3 py-3 text-right font-normal">5m</th>
                  <th className="mono-label px-3 py-3 text-right font-normal">1h</th>
                  <th className="mono-label px-3 py-3 text-right font-normal">6h</th>
                  <th className="mono-label px-3 py-3 text-right font-normal">24h</th>
                  <th scope="col" className="px-3 py-3 text-right font-medium"><span className="inline-flex items-center gap-1">24h swaps<InfoTip label="About pool 24h swaps" text={REGISTRY_TERMS.swaps} align="end" /></span></th>
                  <th scope="col" className="px-3 py-3 text-right font-medium"><span className="inline-flex items-center gap-1">24h volume<InfoTip label="About pool 24h volume" text={REGISTRY_TERMS.volume} align="end" /></span></th>
                  <th className="mono-label px-3 py-3 text-right font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      quote / 1% estimate
                      <InfoTip label="About pool depth" align="end" text={`${REGISTRY_TERMS.v3Holdings} ${REGISTRY_TERMS.v4Depth}`} />
                    </span>
                  </th>
                  <th className="mono-label px-3 py-3 text-right font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      Market cap
                      <InfoTip label="About pool market cap" align="end" text={REGISTRY_TERMS.marketCap} />
                    </span>
                  </th>
                  <th className="mono-label px-3 py-3 pr-4 font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      pool
                      <InfoTip label="About pools" align="end" text={REGISTRY_TERMS.pool} />
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.pools.map(function renderPool(pool, rowIndex) {
                  const token = pool.tokenAddress ? result.tokens.get(pool.tokenAddress) : undefined;
                  const pair = pairText(pool, symbols, token);
                  const change = changes.get(pool.id) ?? empty;
                  const verified = pool.assetId !== null;
                  const address = pricedSideOf(pool);
                  const verdict = address ? trust.get(address.toLowerCase()) : undefined;
                  const level: TrustLevel = verdict?.level ?? "unknown";
                  // Below the floor the pool's price is not something anyone
                  // could trade against, so nothing derived from it is shown.
                  const stateCurrent = stateReadIsCurrent(pool.stateCheckedAt);
                  const stateNotice = pool.stateCheckedAt ? `Pool state last read ${pool.stateCheckedAt.toISOString()}` : "Pool state not read yet";
                  const stateAt = pool.stateCheckedAt?.toISOString() ?? null;
                  const volumeSource = typeof pool.volumeValuation?.source === "string" ? pool.volumeValuation.source : "Indexed canonical Swap events";
                  const volumeReason = typeof pool.volumeValuation?.reason === "string" ? pool.volumeValuation.reason : pool.volumeUsd24h === null ? "A complete current swap window with supported USD valuation is required." : null;
                  const priced = pricingIsMeaningful(pool, priceFloor);
                  const notice =
                    cluster && rowIndex === clusterBreakAt ? (
                      <tr key={`${pool.id}:notice`} className="bg-amber-50">
                        <td colSpan={13} className="px-4 py-2.5 text-[12.5px] leading-6 text-amber-900">
                          {cluster.contracts - 1} other {cluster.contracts - 1 === 1 ? "contract has" : "contracts have"} the name {cluster.symbol}.
                          These are different addresses; pool order does not confirm their issuer identity.{" "}
                          <Link prefetch={false} href={`/registry/lookalikes?q=${encodeURIComponent(cluster.symbol)}`} className="underline underline-offset-4">
                            Compare matching listed tickers
                          </Link>
                          .
                        </td>
                      </tr>
                    ) : null;
                  return (
                    <Fragment key={pool.id}>
                      {notice}
                    <tr>
                      <td className="px-4 py-2.5">
                        <span className="flex items-baseline gap-1.5">
                          {verified ? (
                            <Link prefetch={false} href={`/registry/${encodeURIComponent(pair.base)}`} className="font-mono text-[13.5px] font-semibold text-ink hover:text-hood-deep">
                              {pair.base}
                            </Link>
                          ) : null}
                          {!verified && address ? (
                            <Link prefetch={false} href={`/registry/markets/${address}`} className="font-mono text-[13.5px] font-semibold text-ink hover:text-hood-deep">
                              {pair.base}
                            </Link>
                          ) : null}
                          {!verified && !address ? <span className="font-mono text-[13.5px] font-semibold text-ink">{pair.base}</span> : null}
                          <span className="font-mono text-[12px] text-ink-faint">/ {pair.quote}</span>
                        </span>
                        {pair.name ? <span className="block max-w-[22ch] truncate text-[12px] text-ink-soft">{pair.name}</span> : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <TrustBadge level={level} detail={verdict?.detail} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[12.5px] text-ink-soft">{venueTitle(pool.venue)}</td>
                      <td className="min-w-[150px] px-3 py-2.5 text-right"><TokenMetric compact metric={{ value: priced && pool.priceUsd !== null ? Number(pool.priceUsd) : null, source: "Pool spot price with recorded quote conversion", asOf: stateAt, reason: !stateCurrent ? stateNotice : !priced ? "Price unavailable or pool below the configured quote-value floor." : null }} /></td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{changeCell(priced ? change.change5mPct : null)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{changeCell(priced ? change.change1hPct : null)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{changeCell(priced ? change.change6hPct : null)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12px] tabular-nums">{changeCell(priced ? change.change24hPct : null)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{pool.swaps24h === null ? "—" : pool.swaps24h.toLocaleString("en-US")}</td>
                      <td className="min-w-[190px] px-3 py-2.5 text-right"><TokenMetric compact volume metric={{ value: pool.volumeUsd24h === null ? null : Number(pool.volumeUsd24h), source: volumeSource, asOf: pool.metricsAsOf?.toISOString() ?? null, reason: volumeReason }} /></td>
                      <td className="min-w-[160px] px-3 py-2.5 text-right"><TokenMetric compact metric={{ value: stateCurrent && pool.depthUsd !== null ? Number(pool.depthUsd) : null, source: pool.poolAddress ? "V3 quote holdings" : "V4 bounded 1% estimate", asOf: stateAt, reason: !stateCurrent ? stateNotice : pool.depthUsd === null ? "Quote valuation or pool state is unavailable." : null }} /></td>
                      <td className="px-3 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink" title={verified || !priced || !token ? undefined : `FDV ${usdText(fdvOf(pool, token))}`}>
                        {verified || !priced || !token ? <span className="text-ink-faint">—</span> : usdText(marketCapUsd(token, Number(pool.priceUsd)))}
                      </td>
                      <td className="px-3 py-2.5 pr-4 font-mono text-[11.5px]">
                        <span className="flex flex-col gap-0.5">
                          {pool.poolAddress ? (
                            <a href={explorerAddressUrl(pool.chainId, pool.poolAddress)} target="_blank" rel="noreferrer" className="text-ink-faint underline-offset-4 hover:text-ink hover:underline">
                              {shortHex(pool.poolAddress, 6, 4)}
                            </a>
                          ) : (
                            <span className="text-ink-faint" title={pool.id}>
                              {shortHex(pool.id, 6, 4)}
                            </span>
                          )}
                          <span className="text-[10.5px] text-ink-faint">{feeText(pool.fee)}</span>
                          {sort === "newest" ? <>
                            <span className="mt-1 whitespace-nowrap text-ink-soft">Created at block {pool.createdBlock.toLocaleString("en-US")}</span>
                            <span className="whitespace-nowrap text-ink-soft">Recorded <time dateTime={pool.firstSeenAt.toISOString()} title={pool.firstSeenAt.toISOString()}>{ago(pool.firstSeenAt)}</time></span>
                          </> : null}
                        </span>
                      </td>
                    </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}

        <RegistryPagination basePath="/registry/markets" params={{ ...params, view: "pools" }} page={page} pageSize={PAGE} total={result.total} />

        <details className="mt-3 max-w-3xl text-[14px] leading-6 text-ink"><summary className="cursor-pointer underline underline-offset-4">How pool readings are measured</summary>
          <p className="mt-2">
            Individual pools for listed and community tokens. A token may trade in several pools with different fees.
            The identity badge describes its address; pool prices and activity remain separate readings.
            V3 quote holdings measure the pool&apos;s quote-token balance. V4 depth estimates a bounded 1% price move.
            These measurements are not added together or presented as total value locked.
            {" "}<Link href="/registry/markets" className="underline underline-offset-4">Return to token markets</Link>.
            {sampleRun?.finishedAt ? ` Price job last finished ${ago(sampleRun.finishedAt)}.` : " Price-job time unavailable."}
            {stateRun?.finishedAt ? ` State job last finished ${ago(stateRun.finishedAt)}.` : " State-job time unavailable."}
          </p>

        </details>
        <p className="mt-3 text-[13px] leading-6 text-ink">{swapNote} {!swaps.current && swaps.priorityPoolCount !== undefined ? `Selected scope: ${swaps.priorityPoolCount.toLocaleString("en-US")} priority pools.` : ""} {swaps.lagSeconds !== null ? `Recorded index lag: ${swaps.lagSeconds.toLocaleString("en-US")} seconds.` : "Index lag unavailable."}</p>
        <details className="mt-3 text-[14px] text-ink"><summary className="cursor-pointer underline underline-offset-4">Pool coverage and source times</summary>
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4">
            {[
              { label: "active pairs", value: counts.tiers.active, note: `${counts.listed.toLocaleString("en-US")} with listed tokens; ${counts.community.toLocaleString("en-US")} community; ${counts.lookalike.toLocaleString("en-US")} lookalike` },
              { label: "dormant pairs", value: counts.tiers.dormant + counts.tiers.quiet, note: "drained or idle, kept on record, read less often" },
              { label: "24h swaps", value: swaps24h, note: swapNote, indexing: !swaps.current },
              { label: "24h volume", value: volume24h, note: swapNote, money: true, indexing: !swaps.current },
            ].map(function renderStat(stat) {
              let display = "Unavailable";
              if (!stat.indexing && stat.value !== null) display = stat.money ? usdText(stat.value) : stat.value.toLocaleString("en-US");
              return (
                <div key={stat.label} className="bg-raised px-4 py-3">
                  <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">{stat.label}</dt>
                  <dd className="mt-1 text-[18px] font-medium tabular-nums text-ink">
                    {display}
                  </dd>
                  <dd className="text-[11.5px] text-ink-faint">{stat.note}</dd>
                </div>
              );
            })}
          </dl>
          <SwapIndexerPanel reading={swaps} chainId={RH_MAINNET_ID} />
        </details>
        {filling ? (
          <p className="mt-3 text-[12.5px] text-amber-700">
            Pool discovery is still reading the chain&apos;s history, so the counts are a floor and new pairs are still arriving.
          </p>
        ) : null}

      </main>
      <RegistryFooter />
    </div>
  );
}
