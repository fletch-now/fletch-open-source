import { tokenDiscoveries } from "@/lib/registry/discoveries";
import { LiveAge, LiveValue } from "@/components/registry/live-reading";
import { SortHeading } from "@/components/registry/sort-heading";
import { RegistryPageIntro } from "@/components/registry/page-intro";
import { TableShell } from "@/components/registry/table-shell";
import { RegistryPagination, readPage } from "@/components/registry/pagination";
import { TrustBadge } from "@/components/registry/trust-badge";
import { publicPageMetadata } from "@/lib/seo";
import { eventKindLabel } from "@/lib/registry/authority/events";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { ASSET_TYPE_LABEL, assetTrust, defaultAssetSortOrder, browseAssetsPage, browseFacets, browseSummary, parseFilters } from "@/lib/registry/browse";
import { FilterBar, hrefFor } from "@/components/registry/filter-bar";
import { RegistryExplainer, RegistryGlossary } from "@/components/registry/explainer";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { ROBINHOOD_ASSETS_ENDPOINT } from "@/lib/registry/robinhood";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { authoritySummary, controlState, latestHealth, mostActive, recentAuthorityEvents, statesFor } from "@/lib/registry/authority/read";
import { ledgerProgress } from "@/lib/registry/authority/ledger";
import { poolKindCounts } from "@/lib/registry/authority/dex";
import { AuthorityStrip } from "@/components/registry/authority-strip";
import { feedReadingText, multiplierText, priceText } from "@/components/registry/format";
import { InfoTip } from "@/components/registry/info-tip";
import { REGISTRY_TERMS } from "@/components/registry/terms";
import { publicReadCache } from "@/lib/public-cache";

// The public registry: every Stock Token Robinhood lists on chain 4663, with the
// address, whether Fletch found bytecode at it, and a link to a page per token.
// Filters live in the URL so a filtered view can be shared and indexed.

export const revalidate = 300;

export const metadata: Metadata = publicPageMetadata("/registry");

const COLUMNS = [
  { label: "Symbol", sort: "symbol" as const, help: "The token's short ticker. Use the contract address to distinguish tokens that share a ticker.", right: false },
  { label: "Name", sort: "name" as const, help: "The name recorded in the asset listing. Open it for the token's identity checks, readings and history.", right: false },
  { label: "Type", sort: "type" as const, help: "The asset category recorded by the listing, such as a Stock Token or a bridged token. The identity badge shows the checks for its address.", right: false },
  { label: "Contract", sort: "address" as const, help: REGISTRY_TERMS.contract, right: false },
  { label: "Identity", sort: "verified" as const, help: REGISTRY_TERMS.identity, right: false },
  { label: "Multiplier", sort: "multiplier" as const, help: REGISTRY_TERMS.multiplier, right: true },
  { label: "Feed price", sort: "price" as const, help: REGISTRY_TERMS.feedPrice, right: true },
  { label: "Lookalikes", sort: "lookalikes" as const, help: REGISTRY_TERMS.lookalikes, right: true },
  { label: "State", sort: "state" as const, help: REGISTRY_TERMS.state, right: false },
];

type RegistryRead = {
  result: Awaited<ReturnType<typeof browseAssetsPage>>;
  summary: Awaited<ReturnType<typeof browseSummary>>;
  facets: Awaited<ReturnType<typeof browseFacets>>;
  latest: Awaited<ReturnType<typeof tokenDiscoveries>> | null;
  authority: Awaited<ReturnType<typeof authoritySummary>>;
  control: Awaited<ReturnType<typeof controlState>>;
  health: Awaited<ReturnType<typeof latestHealth>>;
  ledger: Awaited<ReturnType<typeof ledgerProgress>>;
  changes: Awaited<ReturnType<typeof recentAuthorityEvents>>;
  active: Awaited<ReturnType<typeof mostActive>>;
  pools: Awaited<ReturnType<typeof poolKindCounts>>;
  states: Awaited<ReturnType<typeof statesFor>>;
};

// Search parameters make this page dynamic, so route revalidation does not
// coalesce a burst of identical requests. Share a short read window and retry
// failed reads cleanly instead of multiplying database pressure.
const cachedRegistryRead = publicReadCache<RegistryRead>(5_000, 64);

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

// One word for the table: what would make a builder stop before using this token.
// Three cadences of the state job: past this, the row says nothing about now.
const STALE_READ_MS = 15 * 60_000;

function stateText(state: { tokenPaused: boolean | null; canonical: boolean | null; feedStale: boolean | null; stateCheckedAt: Date | null } | undefined): React.ReactNode {
  if (!state || state.stateCheckedAt === null) {
    return <span className="text-ink-faint">not read</span>;
  }
  if (Date.now() - state.stateCheckedAt.getTime() > STALE_READ_MS) {
    return <span className="text-amber-700">stale read</span>;
  }
  if (state.tokenPaused === null && state.canonical === null) {
    return <span className="text-ink-faint">not a Stock Token</span>;
  }
  if (state.tokenPaused) {
    return <span className="text-red-700">paused</span>;
  }
  if (state.canonical === false) {
    return <span className="text-red-700">not canonical</span>;
  }
  if (state.feedStale) {
    return <span className="text-amber-700">feed stale</span>;
  }
  return <span className="text-ink-soft">checks current</span>;
}

function relative(date: Date | null): string {
  if (!date) {
    return "never";
  }
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 48) {
    return `${hours} h ago`;
  }
  return `${Math.round(hours / 24)} days ago`;
}

export default async function TokensPage({ searchParams }: PageProps<"/registry">) {
  const params = await searchParams;
  const filters = parseFilters(params);
  const pagination = readPage(params);
  const read = await cachedRegistryRead(`${RH_MAINNET_ID}:${JSON.stringify(filters)}:${pagination.pageSize}:${pagination.offset}`, async function readRegistry(): Promise<RegistryRead> {
    const [result, summary, facets, latest, authority, control, health, ledger, changes, active, pools] = await Promise.all([
      browseAssetsPage(RH_MAINNET_ID, filters, { limit: pagination.pageSize, offset: pagination.offset }),
      browseSummary(RH_MAINNET_ID),
      browseFacets(RH_MAINNET_ID),
      tokenDiscoveries(RH_MAINNET_ID).catch(() => null),
      authoritySummary(RH_MAINNET_ID),
      controlState(RH_MAINNET_ID),
      latestHealth(RH_MAINNET_ID),
      ledgerProgress(RH_MAINNET_ID),
      recentAuthorityEvents(RH_MAINNET_ID, { limit: 6 }),
      mostActive(RH_MAINNET_ID, 6),
      poolKindCounts(RH_MAINNET_ID),
    ]);
    const states = await statesFor(result.rows.map((asset) => asset.id));
    return { result, summary, facets, latest, authority, control, health, ledger, changes, active, pools, states };
  });
  const { result, summary, facets, latest, authority, control, health, ledger, changes, active, pools, states } = read;
  const apiQuery = new URLSearchParams(hrefFor("/registry", filters, {}, pagination.pageSize).split("?")[1]);
  apiQuery.delete("size");
  apiQuery.set("limit", String(pagination.pageSize));
  apiQuery.set("offset", String(pagination.offset));
  const assets = result.rows;
  const stockTokens = summary.byType.find((entry) => entry.assetType === "stock_token")?.count ?? 0;
  const ledgerAtHead = ledger.behind !== null && ledger.behind <= BigInt(10_000);

  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "Robinhood Chain registry",
    description:
      "Token addresses from Robinhood's published asset list, with recorded identity checks, contract state, market readings and history. Each metric carries its observation time and availability.",
    url: `${APP_URL}/registry`,
    license: "https://creativecommons.org/licenses/by/4.0/",
    creator: { "@type": "Organization", name: "Fletch", url: APP_URL },
    isAccessibleForFree: true,
    keywords: ["Robinhood Chain", "Stock Tokens", "tokenized equities", "price feeds", "chain 4663"],
    temporalCoverage: "2026/..",
    distribution: [
      { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/assets` },
      { "@type": "DataDownload", encodingFormat: "application/atom+xml", contentUrl: `${APP_URL}/registry/changes.xml` },
      { "@type": "DataDownload", encodingFormat: "text/event-stream", contentUrl: `${APP_URL}/api/v1/chains/${RH_MAINNET_ID}/events/stream` },
    ],
  };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Stock Tokens on Robinhood Chain",
    numberOfItems: result.total,
    itemListElement: assets.map(function item(asset, index) {
      return {
        "@type": "ListItem",
        position: pagination.offset + index + 1,
        name: `${asset.symbol}: ${asset.name}`,
        url: `${APP_URL}/registry/${asset.symbol}`,
      };
    }),
  };

  return (
    <div className="relative flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }} />

      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Token registry" actions={<><a href={`/api/v1/chains/${RH_MAINNET_ID}/assets?${apiQuery}`}>JSON</a><Link href="/registry/markets">Token markets</Link></>}>
          {summary.total} recorded assets, including {stockTokens} Stock Tokens. {summary.verified} checked on chain. Latest asset-source observation {relative(summary.lastObservedAt)}.
        </RegistryPageIntro>
        <div className="mt-3 grid gap-6 2xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <FilterBar basePath="/registry" filters={filters} facets={facets} typeCounts={summary.byType} shown={result.total} pageSize={pagination.pageSize} />
            <RegistryPagination basePath="/registry" params={params} page={pagination.page} pageSize={pagination.pageSize} total={result.total} compact />
        {assets.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
            <p className="text-[15px] text-ink">No token matches.</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
              Try a ticker symbol, or{" "}
              <Link href="/registry" className="underline underline-offset-4">
                clear the filters
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="mt-4 min-w-0">
            <TableShell label="Listed token identities and state" className="hidden md:block">
            <table className="w-full min-w-[920px] text-left text-[14px]">
              <thead>
                <tr className="border-b border-line bg-panel/40 text-ink-soft">
                  {COLUMNS.map(function heading(column) {
                    const active = filters.sort === column.sort;
                    let nextOrder = defaultAssetSortOrder(column.sort);
                    if (active) nextOrder = filters.order === "asc" ? "desc" : "asc";
                    return <th key={column.label} scope="col" aria-sort={active ? (filters.order === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-1.5 font-medium ${column.right ? "text-right" : ""}`}>
                      <span className="inline-flex items-center gap-1"><SortHeading label={column.label} href={hrefFor("/registry", filters, { sort: column.sort, order: nextOrder }, pagination.pageSize)} active={active} order={filters.order} nextOrder={nextOrder} /><InfoTip label={`About ${column.label.toLowerCase()}`} text={column.help} align={column.right ? "end" : "start"} /></span>
                      {column.label === "Feed price" ? <span className="block text-[12px] font-normal text-ink-soft">Reference in USD</span> : null}
                    </th>;
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {assets.map(function renderRow(asset) {
                  return (
                    <tr key={asset.id} className="group">
                      <td className="px-5 py-3">
                        <Link href={`/registry/${asset.symbol}`} className="font-mono text-[14px] font-semibold text-ink hover:text-hood-deep">
                          {asset.symbol}
                        </Link>
                      </td>
                      <td className="px-2.5 py-3 text-ink">
                        <Link href={`/registry/${asset.symbol}`} title={asset.name} className="block max-w-[24ch] truncate 2xl:max-w-[20ch] hover:text-hood-deep">
                          {asset.name}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-[13px] text-ink-soft">{ASSET_TYPE_LABEL[asset.assetType as keyof typeof ASSET_TYPE_LABEL] ?? asset.assetType}</td>
                      <td className="px-2.5 py-3">
                        <a
                          href={explorerAddressUrl(asset.chainId, asset.address)}
                          target="_blank"
                          rel="noreferrer"
                          className="whitespace-nowrap font-mono text-[12.5px] text-ink underline-offset-4 hover:underline"
                        >
                          {shortAddress(asset.address)}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-[12.5px]">
                        <TrustBadge level={assetTrust(asset).level} detail={assetTrust(asset).detail} />
                      </td>
                      <td className="px-2.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-ink"><LiveValue value={multiplierText(states.get(asset.id)?.uiMultiplier)} /></td>
                      <td className="px-2.5 py-3 text-right font-mono text-[12.5px] tabular-nums text-ink"><LiveValue value={priceText(states.get(asset.id)?.feedPrice)} /><p className="mt-1 text-[10px] text-ink-faint">{feedReadingText(states.get(asset.id))}</p></td>
                      <td className="px-2.5 py-3 text-right font-mono text-[12.5px] tabular-nums">
                        {asset.lookalikeCount > 0 ? (
                          <Link href={`/registry/${asset.symbol}#lookalikes`} className="text-ink underline-offset-4 hover:underline">
                            {asset.lookalikeCount}
                          </Link>
                        ) : (
                          <span className="text-ink-faint">0</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-3 text-[12px]">{stateText(states.get(asset.id))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </TableShell>
            <ul className="divide-y divide-line rounded-card border border-line bg-raised md:hidden">
              {assets.map(function renderCard(asset) {
                return (
                  <li key={asset.id}>
                    <Link href={`/registry/${asset.symbol}`} className="flex items-center gap-3 px-4 py-3.5">
                      <span className="w-16 shrink-0 font-mono text-[13.5px] font-semibold text-ink">{asset.symbol}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] text-ink">{asset.name}</span>
                        <span className="block font-mono text-[12px] leading-6 text-ink">{shortAddress(asset.address)}</span>
                      </span>
                      <span aria-hidden="true" className="text-ink-faint">→</span>
                    </Link>
                    <div className="px-4 pb-3">
                      <TrustBadge level={assetTrust(asset).level} detail={assetTrust(asset).detail} />
                      <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px] leading-6 text-ink">
                        <div><dt className="flex items-center gap-1">Feed price <InfoTip label={`About ${asset.symbol} feed price`} text={REGISTRY_TERMS.feedPrice} /></dt><dd className="font-mono tabular-nums">{priceText(states.get(asset.id)?.feedPrice)}</dd></div>
                        <div><dt className="flex items-center gap-1">Multiplier <InfoTip label={`About ${asset.symbol} multiplier`} text={REGISTRY_TERMS.multiplier} /></dt><dd className="font-mono tabular-nums">{multiplierText(states.get(asset.id)?.uiMultiplier)}</dd></div>
                      </dl>
                      <p className="mt-2 text-[12px] leading-5 text-ink-soft">{feedReadingText(states.get(asset.id))}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <RegistryPagination basePath="/registry" params={params} page={pagination.page} pageSize={pagination.pageSize} total={result.total} />

        <details className="mt-5 text-[13px] leading-5 text-ink-soft"><summary className="cursor-pointer text-ink">How to read the registry</summary><p className="mt-2">Match the full address before using a token. Identity badges describe listing checks. Feed price is a USD reference; Markets shows trading-pool prices. Each reading has its own source and age.</p></details>
        <section className="mt-10 grid gap-6 border-t border-line pt-6 md:grid-cols-3">
          <div>
            <h2 className="text-[15px] font-medium text-ink">Where the list comes from</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              Stock Token addresses come from Robinhood&apos;s public asset list, checked every fifteen minutes.
              Bridged assets come from recorded gateway mappings. Fletch keeps one row per contract on chain {RH_MAINNET_ID}, with each source&apos;s observation time.
            </p>
            <a href={ROBINHOOD_ASSETS_ENDPOINT} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[12px] text-ink-faint underline-offset-4 hover:underline">
              {ROBINHOOD_ASSETS_ENDPOINT}
            </a>
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-ink">What verified means here</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              Three separate facts. Robinhood publishes the address. The chain returns bytecode at it. The contract
              answers with the same symbol and decimals as the listing. A row reads verified only with all three, and
              a disagreement is shown rather than hidden. None of this audits what the contract does.
            </p>
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-ink">What you can do with a token</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              Watch it: Fletch messages your Telegram when a transfer above a threshold lands, sequencer-confirmed.
              Build on it: describe a page for it and Fletch writes and compiles the code.
            </p>
            <Link href="/dashboard/watch/new" className="mt-2 inline-block text-[13px] text-hood-deep underline underline-offset-4">
              Create a watcher
            </Link>
            <p className="mt-4 text-[13px] leading-6 text-ink-faint">
              For agents and scripts:{" "}
              <a href="/llms.txt" className="underline underline-offset-4 hover:text-ink">
                llms.txt
              </a>
              ,{" "}
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/assets?${apiQuery}`} className="underline underline-offset-4 hover:text-ink">
                the assets endpoint
              </a>
              , and{" "}
              <a href="/registry/feed.xml" className="underline underline-offset-4 hover:text-ink">
                the new-listings feed
              </a>
              .
            </p>
          </div>
        </section>
          </div>

          <aside className="grid min-w-0 content-start gap-5 self-start md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-1">
            <AuthorityStrip summary={authority} control={control} health={health} stockTokens={stockTokens} ledger={ledger} layout="rail" />
            <section className="overflow-hidden rounded-card border border-line bg-raised">
              <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
                <h2 className="text-[15px] font-medium text-ink">DEX markets</h2>
                <Link href="/registry/markets" className="text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
                  Token markets
                </Link>
              </div>
              <dl className="grid grid-cols-2 gap-px bg-line">
                <div className="bg-raised px-4 py-3">
                  <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">pools with listed tokens</dt>
                  <dd className="mt-1 text-[15px] font-medium tabular-nums text-ink">{pools.listed.toLocaleString("en-US")}</dd>
                  <dd className="text-[11.5px] text-ink-faint">one side on Robinhood&apos;s list</dd>
                </div>
                <div className="bg-raised px-4 py-3">
                  <dt className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">community pools</dt>
                  <dd className="mt-1 text-[15px] font-medium tabular-nums text-ink">{pools.community.toLocaleString("en-US")}</dd>
                  <dd className="text-[11.5px] text-ink-faint">memecoins and other tokens, as their contracts say</dd>
                </div>
              </dl>
              <p className="px-5 py-3 text-[12.5px] leading-5 text-ink-soft">
                Recorded Uniswap markets show token-level prices, activity and available volume. Open a token for its address, identity checks and the source and age of each reading.
              </p>
            </section>
          <section className="overflow-hidden rounded-card border border-line bg-raised">
            <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
              <h2 className="text-[15px] font-medium text-ink">Activity</h2>
              <Link href="/registry/changes" className="text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
                changelog
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {changes.length === 0 ? <li className="px-5 py-4 text-[13px] text-ink-soft">Nothing recorded yet.</li> : null}
              {changes.map(function renderChange(event) {
                return (
                  <li key={event.id} className="px-5 py-3">
                    <p className="text-[13px] leading-5 text-ink">
                      {event.symbol && !event.title.startsWith(event.symbol) ? (
                        <Link href={`/registry/${event.symbol}`} className="mr-1 font-medium">
                          {event.symbol}
                        </Link>
                      ) : null}
                      {event.title}
                    </p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                      <span title={event.kind}>{eventKindLabel(event.kind)}</span> · {relative(event.observedAt)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="overflow-hidden rounded-card border border-line bg-raised">
            <div className="flex items-baseline justify-between border-b border-line px-5 py-3">
              <h2 className="text-[15px] font-medium text-ink">Busiest {ledgerAtHead && active[0] ? `on ${active[0].day}` : "day"}</h2>
              <span className="text-[12.5px] text-ink-faint">transfers · settled vs USDG · off-hours</span>
            </div>
            <ul className="divide-y divide-line">
              {!ledgerAtHead ? (
                <li className="px-5 py-4 text-[13px] leading-5 text-ink-soft">
                  The holder ledger is still reading the chain&apos;s history{ledger.block ? ` (block ${ledger.block.toLocaleString("en-US")})` : ""}. Daily activity is shown once it reaches the head.
                </li>
              ) : null}
              {ledgerAtHead && active.length === 0 ? <li className="px-5 py-4 text-[13px] text-ink-soft">The holder ledger has not written a day yet.</li> : null}
              {(ledgerAtHead ? active : []).map(function renderActive(row) {
                return (
                  <li key={row.assetId} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                    <Link href={`/registry/${row.symbol}`} className="w-16 shrink-0 font-mono font-semibold text-ink">
                      {row.symbol}
                    </Link>
                    <span className="ml-auto font-mono tabular-nums text-ink">{row.transfers.toLocaleString("en-US")}</span>
                    <span className="w-12 text-right font-mono tabular-nums text-ink-soft">{row.transfers ? `${Math.round((row.dvpTransfers / row.transfers) * 100)}%` : "—"}</span>
                    <span className="w-12 text-right font-mono tabular-nums text-ink-soft">{row.transfers ? `${Math.round((row.offhoursTransfers / row.transfers) * 100)}%` : "—"}</span>
                  </li>
                );
              })}
            </ul>
          </section>


        <section className="overflow-hidden rounded-card border border-line bg-raised" aria-label="Latest token discoveries">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
            <h2 className="text-[15px] font-medium text-ink">Latest token discoveries</h2>
            <div className="flex gap-3 text-[12.5px] text-ink-faint">
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/discoveries`} className="underline underline-offset-4 hover:text-ink">JSON</a>
              <a href="/registry/feed.xml" className="underline underline-offset-4 hover:text-ink">RSS</a>
            </div>
          </div>
          {latest ? (
            <>
              <p className="px-5 py-2 text-[12px] text-ink-soft">Includes community tokens. Updates every 30 seconds.</p>
              <ul className="divide-y divide-line">
                {latest.items.slice(0, 6).map(function renderDiscovery(token) {
                  return (
                    <li key={token.address} className="registry-activity-enter">
                      <Link href={`/registry/markets/${token.address}`} className="flex min-w-0 flex-col gap-1 px-5 py-3 transition-colors hover:bg-panel/50">
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="max-w-[45%] truncate font-mono text-[14px] font-semibold text-ink">{token.symbol}</span>
                          <span className="min-w-0 truncate text-[13px] text-ink-soft">{token.name}</span>
                        </span>
                        <span className="font-mono text-[11.5px] text-ink-faint" title={token.address}>{shortAddress(token.address)}</span>
                        <span className="text-[12px] text-ink-soft">First recorded <LiveAge at={token.firstSeenAt} initialLabel={relative(new Date(token.firstSeenAt))} /></span>
                        <span className="text-[11.5px] text-ink-faint">{token.source === "asset_list" ? "Asset list" : "Contract metadata"}. Checked {token.metadataCheckedAt ? <LiveAge at={token.metadataCheckedAt} initialLabel={relative(new Date(token.metadataCheckedAt))} /> : "not yet"}.</span>
                      </Link>
                      <div className="px-5 pb-3"><TrustBadge level={token.trust.level} detail={token.trust.detail} /></div>
                    </li>
                  );
                })}
              </ul>
              {latest.items.length === 0 && <p className="px-5 py-3 text-sm text-ink-soft">No token discoveries have been recorded yet.</p>}
              <p className="px-5 py-2 text-[11.5px] text-ink-faint">Records read <LiveAge at={latest.asOf} initialLabel={relative(new Date(latest.asOf))} />.</p>
            </>
          ) : <p role="status" className="px-5 py-4 text-sm text-amber-700">Token discoveries are temporarily unavailable. This page retries in the background.</p>}
          <div className="border-t border-line px-5 py-3 text-[12px] leading-5 text-ink-soft">
            <p>Dates show when Fletch first recorded an address. Older contracts can appear during indexing. Discovery does not establish a new deployment, a Robinhood app listing or trading activity.</p>
            <Link href="/registry/markets?view=pools&sort=newest&tier=all" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">See newest recorded pool creations</Link>
          </div>
        </section>

            <RegistryExplainer compact />
            <RegistryGlossary />
        <section className="rounded-card border border-line bg-raised px-5 py-4">
          <h2 className="text-[15px] font-medium text-ink">For agents and integrations</h2>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-6 text-ink-soft">
            Everything on this page is served as data, with ETags so a poll that finds nothing new costs nothing. Reads need no
            key; 120 requests a minute per address.
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
            <li>
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/assets?${apiQuery}`} className="underline underline-offset-4 hover:text-ink">
                assets with state, JSON
              </a>
            </li>
            <li>
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/events`} className="underline underline-offset-4 hover:text-ink">
                changelog, JSON with cursor
              </a>
            </li>
            <li>
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/events/stream`} className="underline underline-offset-4 hover:text-ink">
                changelog, live stream
              </a>
            </li>
            <li>
              <a href="/registry/changes.xml" className="underline underline-offset-4 hover:text-ink">
                changelog, Atom
              </a>
            </li>
            <li>
              <Link href="/registry/lookalikes" className="underline underline-offset-4 hover:text-ink">
                lookalike tokens
              </Link>
            </li>
            <li>
              <Link href="/registry/issuer" className="underline underline-offset-4 hover:text-ink">
                issuer paperwork
              </Link>
            </li>
            <li>
              <Link href="/registry/status" className="underline underline-offset-4 hover:text-ink">
                freshness of every figure
              </Link>
            </li>
            <li>
              <a href={`/api/v1/chains/${RH_MAINNET_ID}/bridge`} className="underline underline-offset-4 hover:text-ink">
                bridge, JSON
              </a>
            </li>
            <li>
              <a href="/api/v1/openapi.json" className="underline underline-offset-4 hover:text-ink">
                OpenAPI
              </a>
            </li>
            <li>
              <a href="/llms.txt" className="underline underline-offset-4 hover:text-ink">
                llms.txt
              </a>
            </li>
            <li>
              <a href="https://github.com/fletch-now/fletch-mcp" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                MCP server, on GitHub
              </a>
            </li>
          </ul>
        </section>
          </aside>
        </div>
      </main>
      <RegistryFooter />
    </div>
  );
}
