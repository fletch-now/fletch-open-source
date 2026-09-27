import { StockPairings } from "@/components/registry/stock-pairings";
import { AppStatus } from "@/components/registry/app-status";
import { observedMetric } from "@/lib/registry/metric-observation";
import { breadcrumbJsonLd, canonical, pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import { cache, type ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { TrustBadge } from "@/components/registry/trust-badge";
import { RegistryPagination, readPage } from "@/components/registry/pagination";
import { TokenMetric, tokenSupply } from "@/components/registry/token-metric";
import { ago, shortHex } from "@/components/registry/format";
import { RH_MAINNET_ID } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { db } from "@/lib/db";
import { dexTokens } from "@/lib/db/schema";
import { enqueueMarketSearch } from "@/lib/registry/authority/market-refresh";
import { clientIp } from "@/lib/ratelimit";
import { trustForToken } from "@/lib/registry/trust";
import { readTokenMarket } from "@/lib/registry/token-markets";
import type { Metric } from "@/lib/registry/token-markets-types";

export const revalidate = 60;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const readTrust = cache((address: string) => trustForToken(RH_MAINNET_ID, address));

export async function generateMetadata({ params }: PageProps<"/registry/markets/[address]">): Promise<Metadata> {
  const { address } = await params;
  const lower = address.toLowerCase();
  if (!ADDRESS.test(lower)) {
    notFound();
  }
  if (address !== lower) permanentRedirect(`/registry/markets/${lower}`);
  const trust = await readTrust(lower);
  const name = trust.symbol ?? lower;
  const rows = await db.select({ hidden: dexTokens.hidden }).from(dexTokens)
    .where(and(eq(dexTokens.chainId, RH_MAINNET_ID), eq(dexTokens.address, lower))).limit(1);
  const metadata = pageMetadata(`/registry/markets/${lower}`, `${name.slice(0, 36)} price, markets and contract`, `${(trust.name ?? name).slice(0, 60)} (${name.slice(0, 20)}) on Robinhood Chain. Inspect recorded price, trading activity, token supply and address checks for ${lower}.`,
    trust.level !== "unknown" && rows[0]?.hidden !== true);
  metadata.alternates = { ...metadata.alternates, types: { "application/json": canonical(`/api/v1/tokens/${lower}`) } };
  return metadata;
}

export default async function TokenPage({ params, searchParams }: PageProps<"/registry/markets/[address]">): Promise<ReactElement> {
  const { address } = await params;
  const lower = address.toLowerCase();
  if (!ADDRESS.test(lower)) notFound();
  if (address !== lower) permanentRedirect(`/registry/markets/${lower}`);
  await enqueueMarketSearch(RH_MAINNET_ID, lower, clientIp(await headers()));
  const [trust, token] = await Promise.all([readTrust(lower), readTokenMarket(RH_MAINNET_ID, lower)]);
  const query = await searchParams;
  const pagination = readPage(query);
  const alternatives = token?.alternatives.slice(pagination.offset, pagination.offset + pagination.pageSize) ?? [];
  const missing: Metric<number> = observedMetric<number>(null, null, null, "No market reading is recorded for this address. Metadata or pool discovery may be pending.");
  const metrics = [
    { label: "DEX price", metric: token?.priceUsd ?? missing },
    { label: "24h USD volume", metric: token?.volumeUsd24h ?? missing, volume: true },
    { label: "Market cap estimate", metric: token?.marketCapUsd ?? missing },
    { label: "24h swaps", metric: token?.swaps24h ?? missing, dollars: false },
    { label: "24h transactions", metric: token?.transactions24h ?? missing, dollars: false },
  ];
  return (
    <div className="relative flex flex-1 flex-col">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
        breadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Registry", path: "/registry" }, { name: "Token markets", path: "/registry/markets" }, { name: token?.symbol ?? trust.symbol ?? lower, path: `/registry/markets/${lower}` }]),
        { "@context": "https://schema.org", "@type": "WebPage", name: `${token?.name ?? trust.name ?? lower} token markets`, url: canonical(`/registry/markets/${lower}`), description: "Recorded contract identity and selected-pool market observations on Robinhood Chain.", about: { "@type": "Thing", name: token?.name ?? trust.name ?? lower, identifier: `eip155:${RH_MAINNET_ID}:${lower}` }, isPartOf: { "@type": "WebSite", name: "Fletch", url: canonical("/") } },
      ]).replaceAll("<", "\\u003c") }} />
      <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          <Link href="/" className="inline-flex min-h-9 items-center underline underline-offset-4">Home</Link><span aria-hidden="true">/</span>
          <Link href="/registry" className="inline-flex min-h-9 items-center underline underline-offset-4">Registry</Link><span aria-hidden="true">/</span>
          <Link href="/registry/markets" className="inline-flex min-h-9 items-center underline underline-offset-4">Token markets</Link><span aria-hidden="true">/</span>
          <span aria-current="page">{token?.symbol ?? trust.symbol ?? shortHex(lower)}</span>
        </nav>
        <section aria-labelledby="token-identity" className="mt-3">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-3"><h1 id="token-identity" className="display break-words text-[32px] leading-tight text-ink">{token?.symbol ?? trust.symbol ?? "Unknown token"}</h1><TrustBadge level={token?.trust ?? trust.level} detail={trust.detail} /></div><div className="flex gap-4 text-[13px]"><a href={`/api/v1/tokens/${lower}`} className="underline underline-offset-4">JSON</a><Link href={`/dashboard/watch/new?address=${lower}`} className="underline underline-offset-4">Watch token</Link></div></div>
          <p className="mt-1 text-[15px] text-ink-soft">{token?.name ?? trust.name ?? "Name unavailable"}</p>
          <a href={explorerAddressUrl(RH_MAINNET_ID, lower)} title={lower} className="mt-1 inline-block font-mono text-[12px] underline underline-offset-4" data-token-address>{shortHex(lower)} · Chain {RH_MAINNET_ID}</a>
          {token?.stockToken?.verified ? <p className="mt-2 text-[13px]">Verified Stock Token address. <a href={token.stockToken.source ?? "https://api.robinhood.com/rhj/assets"} className="underline underline-offset-4">Robinhood asset list</a> · {token.stockToken.observedAt ? <time dateTime={token.stockToken.observedAt}>{ago(new Date(token.stockToken.observedAt))}</time> : "observation time unavailable"}.</p> : null}
          {token?.robinhoodApp ? <AppStatus reading={token.robinhoodApp} compact /> : null}
        </section>
        <section aria-labelledby="token-markets" className="mt-5">
          <h2 id="token-markets" className="text-[19px] font-medium text-ink">Market readings</h2>
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-ink-soft">Selected-pool readings, with source and age. Market cap estimates outstanding supply × selected price; circulating supply is unverified.</p>
          <dl className="mt-4 grid gap-px overflow-hidden rounded-card border border-line bg-line grid-cols-2 lg:grid-cols-3">
            {metrics.map(function metricCard(item): ReactElement {
              return <div key={item.label} className="bg-raised p-4"><dt className="mb-2 text-[12px] font-medium text-ink-soft">{item.label}</dt><dd><TokenMetric metric={item.metric} dollars={item.dollars} volume={item.volume} /></dd></div>;
            })}
          </dl>
          <div className="mt-4 flex flex-wrap gap-5 text-[13px]">
            <Link href={`/registry/markets?view=pools&q=${lower}`} className="underline underline-offset-4">View {token ? `${token.poolCount} ` : ""}recorded pools</Link>
            {token?.bestPoolId ? <Link href={`/registry/markets?view=pools&q=${encodeURIComponent(token.bestPoolId)}`} className="underline underline-offset-4">Inspect the selected pool</Link> : null}
          </div>
          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-line p-4"><dt className="mb-2 text-[13px] font-medium">V3 quote holdings</dt><dd><TokenMetric metric={token?.v3QuoteHoldingsUsd ?? missing} /></dd><dd className="mt-3 text-[12px] leading-5 text-ink-soft">Largest recorded quote-token balance in a tracked V3 pool, including fees.</dd></div>
            <div className="rounded-card border border-line p-4"><dt className="mb-2 text-[13px] font-medium">V4 1% depth estimate</dt><dd><TokenMetric metric={token?.v4OnePercentDepthUsd ?? missing} /></dd><dd className="mt-3 text-[12px] leading-5 text-ink-soft">Largest bounded quote estimate for a 1% price move in a tracked V4 pool.</dd></div>
          </dl>
          <p className="mt-3 text-[12px] leading-5 text-ink-faint">These two measurements are kept separate. Neither is presented as token-wide TVL.</p>
        </section>
        <section aria-labelledby="token-selection" className="mt-8 rounded-card border border-line bg-raised p-5">
          <h2 id="token-selection" className="text-[17px] font-medium text-ink">Why this address is shown</h2>
          <p className="mt-2 text-[14px] leading-6 text-ink-soft">{token?.selectionReason ?? "This page was opened by its exact address. No economic comparison is available."}</p>
          {token?.dominantAddress ? <p className="mt-3 text-[13px] leading-6 text-ink-soft">Selected contract for this name: <Link href={`/registry/markets/${token.dominantAddress}`} className="break-all font-mono underline underline-offset-4">{token.dominantAddress}</Link></p> : null}
          {token?.closeCall ? <p className="mt-2 text-[13px] leading-6 text-ink-soft">The comparison is close. Review the other addresses and their measurements before choosing a contract.</p> : null}
          <p className="mt-2 text-[12px] leading-5 text-ink-faint">Economic activity identifies a market to inspect. Issuer identity is determined separately by the address checks above.</p>
          <a href="#alternatives" className="mt-3 inline-block text-[13px] underline underline-offset-4">Compare same-name contracts</a>
        </section>
        <StockPairings pairs={token?.stockPairings ?? []} summary={token?.stockPairingSummary} />
        <details className="mt-6 rounded-card border border-line p-4"><summary className="cursor-pointer text-[17px] font-medium">Contract identity and token supply</summary><p className="mt-3 break-all font-mono text-[12px]">{lower}</p><p className="mt-2 text-[13px] leading-5 text-ink-soft">{trust.detail}</p><p className="mt-2 text-[12px] text-ink-soft">Identity source: {trust.source === "registry" ? "Robinhood asset list and contract checks" : "recorded contract metadata and listing comparison"}. Metadata read {trust.readAt ? ago(trust.readAt) : "not yet"}.</p>
          {token ? <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-card border border-line p-4"><dt className="mb-2 text-[13px] font-medium">Decimals</dt><dd><TokenMetric metric={token.decimals} dollars={false} /></dd></div>
            <div className="min-w-0 rounded-card border border-line p-4"><dt className="mb-2 text-[13px] font-medium">Total token supply</dt><dd className="break-all"><TokenMetric metric={token.totalSupplyRaw} displayValue={tokenSupply(token.totalSupplyRaw.value, token.decimals.value)} /></dd></div>
          </dl> : null}
          {token?.metadataReason ? <p className="mt-3 text-[13px] leading-5 text-ink-soft">{token.metadataReason}</p> : null}
        </details>
        <section id="alternatives" className="mt-10 scroll-mt-20" aria-labelledby="token-alternatives">
          <h2 id="token-alternatives" className="text-[19px] font-medium text-ink">Same-name alternatives</h2>
          <p className="mt-2 text-[14px] leading-6 text-ink-soft">Names and tickers can be reused. Open each address to compare its identity and recorded market data.</p>
          {token?.alternatives.length ? <><RegistryPagination basePath={`/registry/markets/${lower}`} params={query} page={pagination.page} pageSize={pagination.pageSize} total={token.alternatives.length} anchor="alternatives" /><ul className="mt-4 divide-y divide-line rounded-card border border-line">{alternatives.map(function alternative(item): ReactElement {
            return <li key={item.address} className="p-4"><Link href={`/registry/markets/${item.address}`} className="font-medium underline underline-offset-4">{item.symbol ?? "Unknown symbol"} {item.name ? `(${item.name})` : ""}</Link><p className="mt-2 break-all font-mono text-[12px]">{item.address}</p><p className="mt-2 text-[13px] leading-5 text-ink-soft">{item.reason}</p></li>;
          })}</ul><RegistryPagination basePath={`/registry/markets/${lower}`} params={query} page={pagination.page} pageSize={pagination.pageSize} total={token.alternatives.length} anchor="alternatives" /></> : <p className="mt-4 rounded-card border border-line p-4 text-[13px] text-ink-soft">No same-name alternatives are recorded. Unread metadata and undiscovered contracts can limit this comparison.</p>}
          {trust.impersonates ? <p className="mt-4 text-[13px] leading-6 text-ink-soft">Published listing with a matching name: <Link href={`/registry/markets/${trust.impersonates.address}`} className="break-all font-mono underline underline-offset-4">{trust.impersonates.address}</Link>. A collision does not establish fraudulent intent.</p> : null}
        </section>
        <section className="mt-10 border-t border-line pt-6" aria-labelledby="token-history">
          <h2 id="token-history" className="text-[19px] font-medium text-ink">History and coverage</h2>
          <p className="mt-2 text-[14px] leading-6 text-ink-soft">First recorded {trust.firstSeenAt ? ago(trust.firstSeenAt) : "time unavailable"}. The 24-hour measurements above describe their recorded window; missing history remains unavailable.</p>
          {trust.source === "registry" && trust.symbol ? <Link href={`/registry/${encodeURIComponent(trust.symbol)}#history`} className="mt-3 inline-block text-[13px] underline underline-offset-4">Open listed-asset history</Link> : null}
        </section>
        <div className="mt-8 flex flex-wrap gap-5 text-[13px]">
          <a href={explorerAddressUrl(RH_MAINNET_ID, lower)} className="underline underline-offset-4">Contract on explorer</a>
          <a href={`/api/v1/tokens/${lower}`} className="underline underline-offset-4">This token as JSON</a>
          <Link href={`/dashboard/watch/new?address=${lower}`} className="underline underline-offset-4">Watch this token</Link>
        </div>
      </main>
      <RegistryFooter />
    </div>
  );
}
