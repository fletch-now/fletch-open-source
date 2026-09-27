import { RefreshReading } from "@/components/registry/refresh-reading";
import { StockPairings } from "@/components/registry/stock-pairings";
import { readStockPairingSummaries } from "@/lib/registry/stock-pairings";
import { AppStatus } from "@/components/registry/app-status";
import { readAppCatalog, statusForSymbol } from "@/lib/registry/app-catalog";
import { readTokenMarkets } from "@/lib/registry/token-markets";
import { TrustBadge } from "@/components/registry/trust-badge";
import { pageMetadata } from "@/lib/seo";
import { trustForToken } from "@/lib/registry/trust";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { notFound, permanentRedirect } from "next/navigation";
import { StatePanel } from "@/components/registry/state-panel";
import { LookalikePanel } from "@/components/registry/lookalike-panel";
import { FeedHistory } from "@/components/registry/feed-history";
import { DexPanel } from "@/components/registry/dex-panel";
import { HistoryPanel } from "@/components/registry/history-panel";
import { BridgePanel } from "@/components/registry/bridge-panel";
import { bridgeEscrowFor, bridgeFlowsFor } from "@/lib/registry/authority/bridge";
import { issuerDocumentsFor } from "@/lib/registry/authority/issuer";
import { poolsFor, venueScans } from "@/lib/registry/authority/dex";
import { historyCoverage, historyFor, utcDay, windowEndingOn } from "@/lib/registry/authority/state-daily";
import { lastRunOf } from "@/lib/registry/authority/runs";
import { controlEventsForAccount, corporateActionsFor, multiplierHistory, stateFor, supplyHistory, supplySnapshots, lookalikesFor, feedRoundsFor } from "@/lib/registry/authority/read";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { ArrowRight } from "@/components/ui/icons";
import { getAssetBySymbol, listAssets } from "@/lib/registry/assets";
import { ASSET_TYPE_LABEL, assetActivity, assetTrust, tokenOnChain } from "@/lib/registry/browse";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
import { ROBINHOOD_ASSETS_ENDPOINT } from "@/lib/registry/robinhood";

// One page per registry asset: the facts Fletch holds about it, what the chain
// says right now, and the two things a person can do with it. Public and
// indexable; the numbers refresh every five minutes.

export const dynamic = "force-dynamic";

function typeLabel(assetType: string): string {
  return ASSET_TYPE_LABEL[assetType as keyof typeof ASSET_TYPE_LABEL] ?? assetType;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatAmount(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDate(date: Date | null): string {
  if (!date) {
    return "not yet";
  }
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

export async function generateMetadata({ params }: PageProps<"/registry/[symbol]">): Promise<Metadata> {
  const { symbol } = await params;
  const asset = await getAssetBySymbol(RH_MAINNET_ID, decodeURIComponent(symbol).toUpperCase());
  if (!asset) {
    return { title: "Token not found", robots: { index: false, follow: false } };
  }
  const trust = await trustForToken(RH_MAINNET_ID, asset.address);
  return pageMetadata(
    `/registry/${encodeURIComponent(asset.symbol)}`,
    `${asset.symbol} on Robinhood Chain`,
    `${asset.name} (${asset.symbol}): ${trust.label}. Inspect its contract address, recorded state and token provenance on Fletch.`,
  );
}

export default async function TokenPage({ params }: PageProps<"/registry/[symbol]">) {
  const { symbol } = await params;
  const requested = decodeURIComponent(symbol);
  const asset = await getAssetBySymbol(RH_MAINNET_ID, requested.toUpperCase());
  if (!asset) {
    const markets = await readTokenMarkets(RH_MAINNET_ID, { query: requested });
    const match = markets.items.find((item) => item.symbol?.toUpperCase() === requested.toUpperCase());
    if (match) permanentRedirect(`/registry/markets/${match.address}`);
    if (markets.catalogMatches?.length) permanentRedirect(`/registry/markets?q=${encodeURIComponent(requested)}`);
    notFound();
  }
  const appStatus = statusForSymbol(await readAppCatalog(), asset.symbol);
  // One URL per token for search engines: a lowercase or mixed-case symbol lands
  // on the canonical uppercase address rather than a duplicate page.
  if (requested !== asset.symbol) {
    permanentRedirect(`/registry/${asset.symbol}`);
  }
  // The history section shows a quarter: enough for a split or a pause to be
  // visible without pulling a year of rows into a page render.
  const historyWindow = windowEndingOn(utcDay(new Date()), 90);
  const [chain, activity, state, multipliers, supply, snapshots, actions, control, lookalikes, lookalikeRun, rounds, pools, dexScans, allAssets, bridgeFlows, escrow, paperwork, historyDays, coverage] = await Promise.all([
    tokenOnChain(asset),
    assetActivity(asset.id),
    stateFor(asset.id),
    multiplierHistory(asset.id, 20),
    supplyHistory(asset.id, 12),
    supplySnapshots(asset.id, 1),
    corporateActionsFor(asset.symbol, 10),
    controlEventsForAccount(asset.address, 10),
    lookalikesFor(asset.id),
    lastRunOf("lookalikes"),
    feedRoundsFor(asset.id, 200),
    poolsFor(asset.id, 20),
    venueScans(asset.chainId),
    listAssets(RH_MAINNET_ID),
    asset.assetType === "bridged" ? bridgeFlowsFor(asset.id, 25) : Promise.resolve([]),
    asset.assetType === "bridged" ? bridgeEscrowFor(asset.id) : Promise.resolve(null),
    issuerDocumentsFor(asset.id),
    historyFor(asset.id, historyWindow),
    historyCoverage(asset.id),
  ]);
  const finalTerms = paperwork.find((doc) => doc.kind === "final_terms" && doc.goneAt === null) ?? null;
  const symbolById = new Map(allAssets.map((entry) => [entry.id, entry.symbol]));
  const trust = assetTrust(asset);
  const explorer = explorerAddressUrl(asset.chainId, asset.address);
  const watchHref = `/dashboard/watch/new?asset=${encodeURIComponent(asset.id)}&threshold=100000`;
  const eventsHref = `/dashboard/watch/new?kind=token_event&asset=${encodeURIComponent(asset.id)}`;
  const buildHref = `/dashboard/build?p=${encodeURIComponent(`A public page for ${asset.symbol} (${asset.name}) at ${asset.address} on Robinhood Chain showing its live total supply, and the latest transfers`)}`;

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Registry", item: `${APP_URL}/registry` },
        { "@type": "ListItem", position: 2, name: asset.symbol, item: `${APP_URL}/registry/${asset.symbol}` },
      ],
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: `${asset.symbol} on Robinhood Chain`,
      url: `${APP_URL}/registry/${asset.symbol}`,
      about: {
        "@type": "Thing",
        name: asset.name,
        alternateName: asset.symbol,
        identifier: asset.isin ? `ISIN ${asset.isin}` : asset.address,
        description: `${typeLabel(asset.assetType)} on Robinhood Chain (chain id ${asset.chainId}) at ${asset.address}`,
      },
      dateModified: (asset.verifiedAt ?? asset.observedAt).toISOString(),
    },
  ];

  const facts = [
    { label: "Symbol", value: asset.symbol },
    { label: "Name", value: asset.name },
    { label: "Type", value: typeLabel(asset.assetType) },
    { label: "Chain", value: `Robinhood Chain, id ${asset.chainId}` },
    { label: "Decimals", value: String(asset.decimals) },
    { label: "ISIN", value: asset.isin ?? "not published" },
    { label: "First seen by Fletch", value: formatDate(asset.firstSeenAt) },
    { label: "Bytecode found", value: asset.verifiedAt ? formatDate(asset.verifiedAt) : "not yet" },
    { label: "Contract asked", value: asset.metadataCheckedAt ? formatDate(asset.metadataCheckedAt) : "not yet" },
    { label: "Status", value: asset.status },
  ];

  return (
    <div className="relative flex flex-1 flex-col">
      <nav aria-label="On this page" className="sticky top-[100px] z-30 border-b border-line bg-paper/95 backdrop-blur md:top-14">
        <div className="flex w-full items-center gap-4 overflow-x-auto px-4 py-2 font-mono sm:px-6 lg:px-8 text-[11.5px] uppercase tracking-[0.08em] text-ink-faint sm:px-8 lg:px-12">
          <span className="text-ink">{asset.symbol}</span>
          {[["#state", "state"], ["#feed", "feed"], ["#dex", "markets"], ...(asset.assetType === "bridged" ? [["#bridge", "bridge"]] : []), ...(asset.assetType === "stock_token" || asset.assetType === "bridged" ? [["#lookalikes", "lookalikes"]] : []), ["#history", "history"]].map(function renderAnchor([href, label]) {
            return (
              <a key={href} href={href} className="shrink-0 hover:text-ink">
                {label}
              </a>
            );
          })}
        </div>
      </nav>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replaceAll("<", "\\u003c") }} />

      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-2 text-[12.5px] text-ink-faint">
          <Link href="/registry" className="underline-offset-4 hover:text-ink hover:underline">
            Registry
          </Link>
          <span aria-hidden="true">/</span>
          <span className="font-mono text-ink">{asset.symbol}</span>
        </nav>

        <div className="grid gap-5 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <p className="mono-label mb-2">{typeLabel(asset.assetType)} on Robinhood Chain</p>
            <div className="flex items-start gap-4">
              {asset.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- Robinhood's CDN is not in next.config's image hosts
                <img src={asset.logoUrl} alt="" width={56} height={56} className="mt-1 h-9 w-9 shrink-0 rounded-full bg-panel object-contain" />
              ) : null}
              <h1 className="display text-balance text-[32px] leading-tight text-ink">
                <span className="font-mono">{asset.symbol}</span>
                <span className="block text-[16px] text-ink-soft">{asset.name}</span>
              </h1>
            </div>
            <div className="mt-3"><TrustBadge level={trust.level} detail={trust.detail} /></div>
            <AppStatus reading={appStatus} compact />
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px]"><Link href={`/registry/markets/${asset.address}`} className="underline underline-offset-4">Token market data</Link><a href={`/api/v1/chains/${asset.chainId}/assets/${encodeURIComponent(asset.symbol)}`} className="underline underline-offset-4">JSON</a><RefreshReading /></div>
            <details className="mt-3 text-[13px]"><summary className="cursor-pointer">Contract details and watchers</summary>
            <p className="mt-6 max-w-2xl text-[16px] leading-7 text-ink-soft">
              {asset.name} appears in Robinhood&apos;s asset list as {asset.symbol}. Fletch{" "}
              {asset.verifiedAt ? "found bytecode at that address on chain" : "has not yet seen bytecode at that address"}.
              A watcher on it messages your Telegram when a transfer clears a threshold you set.
            </p>

            <div className="mt-8 rounded-card border border-line bg-raised px-5 py-4">
              <TrustBadge level={trust.level} detail={trust.detail} />
              <p className="mt-1 text-[13.5px] leading-6">{trust.detail}</p>
              {asset.onchainSymbol ? (
                <p className="mt-2 font-mono text-[12px] opacity-80">
                  contract answers: {asset.onchainName ?? "no name"} · {asset.onchainSymbol} ·{" "}
                  {asset.onchainDecimals ?? "?"} decimals
                </p>
              ) : null}
            </div>

            <div className="mt-4 rounded-card border border-line bg-raised p-5">
              <p className="mono-label mb-2">contract address</p>
              <a href={explorer} target="_blank" rel="noreferrer" className="break-all font-mono text-[14px] text-ink underline-offset-4 hover:underline">
                {asset.address}
              </a>
              <p className="mt-2 text-[12.5px] text-ink-faint">View the contract on the chain explorer.</p>
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href={watchHref}
                className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-hood px-6 text-[14.5px] font-semibold text-black transition-colors hover:bg-hood-strong"
              >
                <TelegramMark size={13} />
                Watch {asset.symbol} transfers
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} />
              </Link>
              <Link
                href={buildHref}
                className="inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 text-[14.5px] text-ink-soft transition-colors hover:border-ink hover:text-ink"
              >
                Build a page for {asset.symbol}
              </Link>
            </div>
            <p className="mt-3 text-[12.5px] text-ink-faint">
              <Link href={eventsHref} className="underline underline-offset-4 hover:text-ink">
                Alert me when {asset.symbol} is paused, halted, split or its feed goes stale
              </Link>
              {" · "}
              <Link href={`/registry/changes?symbol=${encodeURIComponent(asset.symbol)}`} className="underline underline-offset-4 hover:text-ink">
                changelog for {asset.symbol}
              </Link>
              {finalTerms ? (
                <>
                  {" · "}
                  <a href={finalTerms.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                    issuer&apos;s Final Terms (PDF{finalTerms.lastModified ? `, ${finalTerms.lastModified.toISOString().slice(0, 10)}` : ""})
                  </a>
                </>
              ) : null}
            </p>
            <p className="mt-3 text-[12.5px] text-ink-faint">
              Watching needs a wallet sign-in and a Telegram link, once. Free during the beta.
              {activity.watchers > 0
                ? ` ${activity.watchers} watcher${activity.watchers === 1 ? " is" : "s are"} on ${asset.symbol} right now, ${activity.alerts} alert${activity.alerts === 1 ? "" : "s"} sent.`
                : ""}
            </p>
            </details>
          </div>

          <aside className="lg:col-span-5">
            <div className="overflow-hidden rounded-card border border-line bg-raised">
              <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">Registry facts</h2>
              <dl className="divide-y divide-line">
                {facts.map(function renderFact(fact) {
                  return (
                    <div key={fact.label} className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                      <dt className="text-ink-faint">{fact.label}</dt>
                      <dd className="text-right text-ink">{fact.value}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>

            <div className="mt-4 overflow-hidden rounded-card border border-line bg-raised">
              <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">Recorded contract state</h2>
              <dl className="divide-y divide-line">
                <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                  <dt className="text-ink-faint">Total supply</dt>
                  <dd className="text-right font-mono text-ink">{chain.totalSupply ? formatAmount(chain.totalSupply) : "unavailable"}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                  <dt className="text-ink-faint">Contract code</dt>
                  <dd className="text-right text-ink">{chain.hasCode === null ? "unavailable" : chain.hasCode ? "present" : "none at this address"}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                  <dt className="text-ink-faint">Transfers, last 1,500 blocks (about 2.5 minutes)</dt>
                  <dd className="text-right font-mono text-ink">{chain.recentCount === null ? "unavailable" : chain.recentCount}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 px-5 py-2.5 text-[13.5px]">
                  <dt className="text-ink-faint">Head block</dt>
                  <dd className="text-right font-mono text-ink">{chain.headBlock ?? "unavailable"}</dd>
                </div>
              </dl>
              <p className="border-t border-line px-5 py-2.5 text-[12px] text-ink-faint">
                Read from the chain when this page was generated; refreshed every five minutes.
              </p>
            </div>
          </aside>
        </div>

        <section className="mt-6">
          <AssetPairings address={asset.address} />
          <StatePanel
            chainId={asset.chainId}
            decimals={asset.decimals}
            isStock={asset.assetType === "stock_token"}
            state={state}
            multipliers={multipliers}
            supply={supply}
            snapshots={snapshots}
            actions={actions}
            control={control}
          />
        </section>



        {rounds.length > 1 ? <FeedHistory symbol={asset.symbol} chainId={asset.chainId} rounds={rounds} /> : null}

        {asset.assetType === "bridged" ? <BridgePanel symbol={asset.symbol} chainId={asset.chainId} decimals={asset.decimals} flows={bridgeFlows} escrow={escrow} /> : null}

        {asset.assetType === "stock_token" || asset.assetType === "bridged" ? (
          <DexPanel symbol={asset.symbol} chainId={asset.chainId} pools={pools} symbols={symbolById} state={state} scans={dexScans} />
        ) : null}

        {asset.assetType === "stock_token" || asset.assetType === "bridged" ? (
          <LookalikePanel symbol={asset.symbol} chainId={asset.chainId} canonicalAddress={asset.address} lookalikes={lookalikes} scanned={lookalikeRun !== null} />
        ) : null}

        <HistoryPanel symbol={asset.symbol} chainId={asset.chainId} decimals={asset.decimals} days={historyDays} range={historyWindow} coverage={coverage} />

        <section className="mt-14">
          <h2 className="text-[18px] font-medium text-ink">Largest recent transfers</h2>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {chain.window ? `Transfer events for ${asset.symbol} in ${chain.window}, largest first.` : "The chain could not be read for this page."}
          </p>
          {chain.recent.length === 0 ? (
            <p className="mt-4 rounded-card border border-dashed border-line bg-panel/40 px-5 py-8 text-[14px] text-ink-soft">
              {chain.recentCount === 0 ? `No ${asset.symbol} transfers in the last 1,500 blocks.` : "Nothing to show right now."}
            </p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-card border border-line bg-raised">
              <ul className="divide-y divide-line">
                {chain.recent.map(function renderTransfer(transfer) {
                  return (
                    <li key={`${transfer.txHash}-${transfer.logIndex}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-[13px]">
                      <span className="w-32 shrink-0 font-mono text-[13.5px] text-ink">
                        {formatAmount(transfer.amount)} {asset.symbol}
                      </span>
                      <span className="font-mono text-[12px] text-ink-faint">
                        {shortAddress(transfer.from)} <span aria-hidden="true">→</span> {shortAddress(transfer.to)}
                      </span>
                      <span className="font-mono text-[11.5px] text-ink-faint">block {transfer.blockNumber}</span>
                      <a
                        href={explorerTxUrl(asset.chainId, transfer.txHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto text-[12.5px] text-hood-deep underline underline-offset-4"
                      >
                        tx
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <section className="mt-14 grid gap-8 border-t border-line pt-10 md:grid-cols-2">
          <div>
            <h2 className="text-[15px] font-medium text-ink">How Fletch verifies {asset.symbol}</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              The address comes from Robinhood&apos;s asset endpoint. Every fifteen minutes Fletch asks the chain for the
              bytecode at that address, and weekly it asks the contract for its own name, symbol and decimals. A row
              reads confirmed only when the contract answers with what Robinhood published. That is a check on
              identity, not an audit of what the contract does.
            </p>
            <a href={ROBINHOOD_ASSETS_ENDPOINT} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[12px] text-ink-faint underline-offset-4 hover:underline">
              {ROBINHOOD_ASSETS_ENDPOINT}
            </a>
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-ink">What an alert on {asset.symbol} does</h2>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              A watcher reads each new block on Robinhood Chain and compares every {asset.symbol} transfer against your
              threshold. When one clears it, you get a Telegram message with the amount, the two addresses, and a link
              to the transaction. Alerts are sequencer-confirmed, which is the chain&apos;s own confirmation, and they
              are withdrawn if a reorg removes the block.
            </p>
            <Link href="/registry" className="mt-2 inline-block text-[13px] text-hood-deep underline underline-offset-4">
              All tokens on Robinhood Chain
            </Link>
          </div>
        </section>
      </main>
      <RegistryFooter />
    </div>
  );
}

async function AssetPairings({ address }: { address: string }): Promise<React.ReactElement> {
  const reading = (await readStockPairingSummaries(RH_MAINNET_ID, [address])).get(address.toLowerCase());
  return <StockPairings pairs={reading?.items ?? []} summary={reading?.summary} />;
}
