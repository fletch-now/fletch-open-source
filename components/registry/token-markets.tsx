import { SortHeading } from "./sort-heading";
import { RegistryPageIntro } from "./page-intro";
import { shortHex } from "./format";
import { AppStatus, AppCatalogHealth } from "./app-status";
import { TableShell } from "@/components/registry/table-shell";
import Link from "@/components/ui/navigation-link";
import { headers } from "next/headers";
import type { ReactElement } from "react";
import { RegistryPagination, pageHref } from "@/components/registry/pagination";
import { TrustBadge } from "@/components/registry/trust-badge";
import { TokenMetric } from "@/components/registry/token-metric";
import { InfoTip } from "@/components/registry/info-tip";
import { REGISTRY_TERMS } from "@/components/registry/terms";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { RH_MAINNET_ID } from "@/lib/config";
import { clientIp } from "@/lib/ratelimit";
import { enqueueMarketRefresh } from "@/lib/registry/authority/market-refresh";
import { parseContractQuery } from "@/lib/registry/contract-search-query";
import { readTokenMarkets } from "@/lib/registry/token-markets";
import type { TokenMarketQuery } from "@/lib/registry/token-markets-types";
import { tokenMarketQuery, tokenMarketParams } from "@/lib/api/token-market-query";
import { TokenMarketFilters, TokenMarketShortcuts } from "./token-market-filters";
import { ContractSearchResults } from "./contract-search-results";

interface TokenMarketsProps {
  params: Record<string, string | string[] | undefined>;
}

interface MarketColumn {
  label: string;
  width: number;
  context?: string;
  explanation?: string;
  infoLabel?: string;
  numeric?: boolean;
  sort?: NonNullable<TokenMarketQuery["sort"]>;
}

export async function TokenMarkets({ params }: TokenMarketsProps): Promise<ReactElement> {
  const raw = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) raw.append(key, item);
  }
  if (raw.has("size")) raw.set("pageSize", raw.get("size")!);
  let filters: TokenMarketQuery;
  try {
    filters = tokenMarketQuery(raw);
  } catch (error) {
    return <div className="flex flex-1 flex-col"><main className="px-6 py-10"><h1 className="display text-2xl">Check your market filters</h1><p role="alert" className="mt-3">{error instanceof Error ? error.message : "Invalid filter."}</p><Link href="/registry/markets" className="mt-4 inline-block underline">Reset filters</Link></main><RegistryFooter /></div>;
  }
  const query = filters.query ?? "";
  const pagination = { page: filters.page!, pageSize: filters.pageSize! };
  const result = await readTokenMarkets(RH_MAINNET_ID, filters);
  if (query) {
    const search = parseContractQuery(query);
    const addresses = result.contractSearch?.items.map((token) => token.address) ?? result.items.map((token) => token.address);
    if (search.mode === "address" && (!result.contractSearch?.total || addresses.includes(search.text))) addresses.unshift(search.text);
    const poolIds = result.items.flatMap((token) => token.bestPoolId ? [token.bestPoolId] : []);
    if (search.mode === "pool" || search.mode === "address") poolIds.unshift(search.text);
    await enqueueMarketRefresh(RH_MAINNET_ID, { tokenAddresses: addresses.slice(0, 4), poolIds: poolIds.slice(0, 4) }, clientIp(await headers()));
  }
  const canonicalParams = Object.fromEntries(tokenMarketParams(filters));
  const apiQuery = tokenMarketParams(filters);
  apiQuery.set("page", String(result.page));
  apiQuery.set("pageSize", String(result.pageSize));
  const showSwaps = filters.sort === "swaps" || Boolean(filters.activity);
  const showV3 = filters.sort === "v3_depth" || filters.depth?.startsWith("v3_");
  const showV4 = filters.sort === "v4_depth" || filters.depth?.startsWith("v4_");
  const columns: MarketColumn[] = [
    { label: "Token", sort: "name" as const, width: 240, explanation: REGISTRY_TERMS.identity },
    { label: "Price", sort: "price" as const, width: 140, numeric: true, explanation: REGISTRY_TERMS.dexPrice },
    { label: "24h volume", sort: "volume" as const, context: "Selected pool", width: 165, numeric: true,
      infoLabel: "About 24-hour volume",
      explanation: REGISTRY_TERMS.volume },
    ...(showSwaps ? [{ label: "24h swaps", sort: "swaps" as const, context: "Selected pool", width: 190, numeric: true, explanation: REGISTRY_TERMS.swaps }] : []),
    { label: "Market cap (est.)", sort: "market_cap" as const, width: 165, numeric: true, explanation: REGISTRY_TERMS.marketCap },
    ...(showV3 ? [{ label: "V3 quote holdings", sort: "v3_depth" as const, context: "Largest tracked pool", width: 190, numeric: true, explanation: REGISTRY_TERMS.v3Holdings }] : []),
    ...(showV4 ? [{ label: "V4 1% depth", sort: "v4_depth" as const, context: "Largest tracked pool", width: 190, numeric: true, explanation: REGISTRY_TERMS.v4Depth }] : []),
    { label: "Robinhood catalog", width: 205 },
    { label: "Pools", sort: "pools" as const, width: 90, explanation: REGISTRY_TERMS.pool },
  ];
  const order = filters.order ?? (filters.sort === "name" ? "asc" : "desc");
  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Token markets" actions={<><a href={`/api/v1/chains/${RH_MAINNET_ID}/markets?${apiQuery}`}>JSON</a><Link href="/developers">API guide</Link><RefreshReading /></>}>
          Compare prices and trading activity on Robinhood Chain. One row per token address.
        </RegistryPageIntro>
        <TokenMarketFilters query={filters} pageSize={pagination.pageSize} />
        {result.contractSearchError ? <p role="status" className="mt-3 rounded-xl border border-line p-4 text-[13px]">{result.contractSearchError}</p> : null}
        {result.contractSearch ? <ContractSearchResults result={result.contractSearch} expanded={!result.items.length || result.contractSearch.page > 1} params={canonicalParams} /> : null}
        {query ? <h2 className="mt-4 text-[14px] font-medium">Tracked market readings</h2> : null}
        <RegistryPagination basePath="/registry/markets" params={canonicalParams} page={result.page} pageSize={result.pageSize} total={result.total} compact />
        <p className="mb-2 text-[12px] text-ink-soft sm:hidden">Scroll sideways for volume, market cap and catalog status.</p>
        {result.items.length === 0 ? <p className="mt-5 rounded-card border border-line px-5 py-8 text-[14px] text-ink-soft">No token matches these filters on this page. Remove a filter or return to page 1. Activity and data filters require current observations, so an unread token may be excluded.</p> : (
          <TableShell label="Token markets: scroll horizontally for more columns" className="mt-1">
            <table className="registry-token-markets w-full text-left" style={{ minWidth: columns.reduce((width, column) => width + column.width, 0) }} aria-label="Token markets">
              <colgroup>{columns.map(function columnWidth(column): ReactElement {
                return <col key={column.label} style={{ width: column.width }} />;
              })}</colgroup>
              <thead><tr className="border-b border-line text-[12px] text-ink-soft">{columns.map(function heading(column): ReactElement {
                const active = column.sort === filters.sort;
                let nextOrder: "asc" | "desc" = column.sort === "name" ? "asc" : "desc";
                if (active) nextOrder = order === "asc" ? "desc" : "asc";
                const href = pageHref("/registry/markets", { ...canonicalParams, sort: column.sort, order: nextOrder }, 1, result.pageSize);
                return <th key={column.label} scope="col" aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined} className={`px-4 py-1.5 font-medium ${column.numeric ? "text-right" : ""}`}>
                  <span className="inline-flex items-center gap-1.5">{column.sort ? <SortHeading label={column.label} href={href} active={active} order={order} nextOrder={nextOrder} /> : column.label}{column.explanation ? <InfoTip text={column.explanation} label={column.infoLabel ?? `About ${column.label.toLowerCase()}`} align={column.numeric ? "end" : "start"} /> : null}</span>
                  {column.context ? <span className="mt-1 block text-[12px] font-normal">{column.context}</span> : null}
                </th>;
              })}</tr></thead>
              <tbody className="divide-y divide-line">{result.items.map(function tokenRow(token): ReactElement {
                return <tr key={token.address}>
                  <td className="registry-token-identity px-4 py-3 align-top">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><Link href={`/registry/markets/${token.address}`} className="inline-flex min-h-6 items-center text-[15px] font-medium underline-offset-4 hover:underline">{token.symbol ?? "Unknown token"}</Link><TrustBadge level={token.trust} /></div>
                    <p className="registry-token-name mt-1 text-[12px] text-ink-soft" title={token.name ?? ""}>{token.name ?? "Name unavailable"}</p>
                    <span title={token.address} className="block font-mono text-[11px] text-ink-soft">{shortHex(token.address)}</span>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] [&>a]:inline-flex [&>a]:min-h-6 [&>a]:items-center">{token.alternatives.length ? <Link href={`/registry/markets/${token.address}#alternatives`} className="underline underline-offset-4">{token.alternatives.length} alternatives</Link> : null}{token.stockPairingSummary?.totalPools ? <Link href={`/registry/markets/${token.address}#pairings`} className="underline underline-offset-4">{token.stockPairingSummary.counterparties.toLocaleString("en-US")} paired {token.stockPairingSummary.counterparties === 1 ? "token" : "tokens"}</Link> : null}</div>
                  </td>
                  <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.priceUsd} compact /></td>
                  <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.volumeUsd24h} volume compact /></td>
                  {showSwaps ? <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.swaps24h} dollars={false} compact /></td> : null}
                  <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.marketCapUsd} compact /></td>
                  {showV3 ? <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.v3QuoteHoldingsUsd} compact /></td> : null}
                  {showV4 ? <td className="px-4 py-4 align-top text-right"><TokenMetric metric={token.v4OnePercentDepthUsd} compact /></td> : null}
                  <td className="px-4 py-3 align-top">{token.robinhoodApp ? <AppStatus reading={token.robinhoodApp} stockToken={token.stockToken} compact /> : <span className="text-ink-soft">Not checked</span>}</td>
                  <td className="px-4 py-4 align-top text-[13px]"><Link href={pageHref("/registry/markets", { view: "pools", q: token.address }, 1, pagination.pageSize)} className="underline underline-offset-4">{token.poolCount.toLocaleString("en-US")} pools</Link></td>
                </tr>;
              })}</tbody>
            </table>
          </TableShell>
        )}
        <RegistryPagination basePath="/registry/markets" params={canonicalParams} page={result.page} pageSize={result.pageSize} total={result.total} />
        <TokenMarketShortcuts query={filters} pageSize={pagination.pageSize} />
        <details className="mt-5 text-[13px] leading-6 text-ink-soft"><summary className="cursor-pointer text-ink">Sources, coverage and table definitions</summary>
          <p className="mt-2">Identity badges describe address checks. Price and volume describe each token&apos;s selected pool. Volume requires a complete 24-hour window of valued swaps. Market cap is an estimate from supply evidence and the selected price, not a measure of freely circulating supply.</p>
          <p className="mt-2">Every reading shows its source and age. Unavailable data stays unavailable. Crypto catalog matches use tickers, not contract addresses; Stock Tokens have a separate catalog.</p>
          <div className="mt-2 flex flex-wrap gap-4"><Link href={pageHref("/registry/markets", { view: "pools", q: query }, 1, pagination.pageSize)} className="underline">Individual pools</Link><a href={`/api/v1/chains/${RH_MAINNET_ID}/markets/filters`} className="underline">Filter definitions as JSON</a></div>
        </details>
        {result.catalog ? <AppCatalogHealth reading={result.catalog} /> : null}
        {result.catalogMatches?.some((match) => !match.addresses.length) ? <details id="unmatched-catalog" className="my-4 rounded-card border border-line p-4" open={Boolean(query)}><summary className="cursor-pointer text-sm">{result.catalogMatches.filter((match) => !match.addresses.length).length} crypto catalog symbols with no on-chain match</summary><p className="mt-2 text-sm text-ink-soft">Robinhood&apos;s crypto catalog includes these symbols. No contract with a matching ticker has been found on this chain. On-chain price, volume and market cap are unavailable.</p><div className="mt-3 grid gap-4 sm:grid-cols-2">{result.catalogMatches.filter((match) => !match.addresses.length).map((match) => <div key={match.symbol} className="rounded border border-line p-3"><p className="font-medium">{match.symbol}: {match.name}</p><AppStatus reading={match.status} compact /></div>)}</div></details> : null}
      </main>
      <RegistryFooter />
    </div>
  );
}
