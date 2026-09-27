import Form from "next/form";
import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { ActiveFilter } from "./filter-bar";
import { FilterMenu } from "./filter-menu";
import { pageHref } from "./pagination";
import { MARKET_FILTERS, MARKET_FILTER_KEYS, MARKET_PRESETS, type MarketFilterKey } from "@/lib/registry/market-filters";
import { tokenMarketParams } from "@/lib/api/token-market-query";
import type { TokenMarketQuery } from "@/lib/registry/token-markets-types";

interface TokenMarketFiltersProps {
  query: TokenMarketQuery;
  pageSize: number;
}

export function TokenMarketFilters({ query, pageSize }: TokenMarketFiltersProps): ReactElement {
  const params = Object.fromEntries(tokenMarketParams(query));
  function href(changes: Record<string, string | undefined>): string {
    return pageHref("/registry/markets", { ...params, ...changes }, 1, pageSize);
  }
  function menu(key: MarketFilterKey): ReactElement {
    const definition = MARKET_FILTERS[key];
    let selected = query[key] ?? definition.default;
    if (key === "order") selected = query.order ?? (query.sort === "name" ? "asc" : "desc");
    function label(item: { value: string; label: string }): string {
      if (key === "order") return item.value === "asc" ? "Ascending" : "Descending";
      return item.label;
    }
    const value = label(definition.options.find((option) => option.value === selected)!);
    return <FilterMenu key={key} label={definition.label} value={value} options={definition.options.map(function option(item) {
      let nextValue: string | undefined = item.value;
      if (key !== "order" && item.value === definition.default) nextValue = undefined;
      return { label: label(item), description: item.description, active: selected === item.value, href: href({ [key]: nextValue, ...(key === "sort" ? { order: undefined } : {}) }) };
    })} />;
  }
  const active = MARKET_FILTER_KEYS.filter(function activeFilter(key) {
    const fallback = key === "order" && query.sort === "name" ? "asc" : MARKET_FILTERS[key].default;
    return query[key] && query[key] !== fallback;
  });
  return <section aria-label="Find token markets" className="mt-3">
    <Form scroll={false} action="/registry/markets" className="flex min-w-0 flex-wrap items-center gap-2">
      <label htmlFor="token-market-query" className="sr-only">Search contracts by name, ticker, address, ISIN or explorer link</label>
      <input key={query.query} id="token-market-query" name="q" defaultValue={query.query} maxLength={2048} aria-describedby="contract-search-help" placeholder="Name, ticker, address or explorer link" className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-raised px-3 text-[14px] text-ink sm:max-w-md" />
      {Object.entries(params).filter(([key]) => key !== "q" && key !== "searchPage").map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
      {pageSize === 50 ? <input type="hidden" name="size" value="50" /> : null}
      <button type="submit" className="h-11 rounded-lg bg-ink px-4 text-[14px] font-medium text-paper">Search</button>
      {query.query ? <Link href={href({ q: undefined })} className="inline-flex min-h-11 items-center text-[13px] underline underline-offset-4">Clear search</Link> : null}
    </Form>
    <p id="contract-search-help" className="mt-2 text-[12px] leading-5 text-ink-soft">Search all recorded contracts. Also accepts shortened addresses, stock ISINs and pool addresses or IDs.</p>
    <div className="mt-2 grid grid-cols-2 items-start gap-2 sm:flex sm:flex-wrap" aria-label="Token market filters">{menu("kind")}{menu("sort")}{menu("order")}
      <div className="contents">{menu("trust")}{menu("activity")}{menu("data")}{menu("depth")}{menu("identity")}
        <FilterMenu label="24h volume" value={query.minVolumeUsd === undefined ? "Any amount" : `$${query.minVolumeUsd.toLocaleString("en-US")}+`} options={[
          { label: "Any amount", active: query.minVolumeUsd === undefined, href: href({ minVolumeUsd: undefined }) },
          ...[0, 1_000, 10_000, 100_000, 1_000_000].map(function minimum(value) {
            return { label: `$${value.toLocaleString("en-US")}+`, description: value === 0 ? "Includes measured zero; requires a valued window." : "Complete current selected-pool volume.", active: query.minVolumeUsd === value, href: href({ minVolumeUsd: String(value) }) };
          }),
        ]} />
      </div>

    </div>
    {active.length || query.query || query.minVolumeUsd !== undefined ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3" aria-label="Active filters">
      {query.query ? <ActiveFilter label={`Search: ${query.query}`} href={href({ q: undefined })} /> : null}
      {active.map(function chip(key) {
        const definition = MARKET_FILTERS[key];
        return <ActiveFilter key={key} label={`${definition.label}: ${definition.options.find((option) => option.value === query[key])!.label}`} href={href({ [key]: undefined })} />;
      })}
      {query.minVolumeUsd !== undefined ? <ActiveFilter label={`24h volume: $${query.minVolumeUsd.toLocaleString("en-US")}+`} href={href({ minVolumeUsd: undefined })} /> : null}
      <Link href={pageHref("/registry/markets", {}, 1, pageSize)} className="inline-flex min-h-11 items-center px-2 py-1.5 text-[13px] text-ink underline underline-offset-4">Reset all</Link>
    </div> : null}
  </section>;
}

export function TokenMarketShortcuts({ query, pageSize }: TokenMarketFiltersProps): ReactElement {
  const params = Object.fromEntries(tokenMarketParams(query));
  return <div className="mt-4 border-t border-line pt-3">
    <div className="mt-1 flex w-full items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap" role="region" aria-label="Market shortcuts" tabIndex={0}>
      <span className="mr-1 shrink-0 text-[13px] text-ink">Explore</span>
      {MARKET_PRESETS.map(function preset(item) {
        const presetParams = { ...item.query, ...(query.query ? { q: query.query } : {}) };
        const selected = Object.entries(presetParams).every(([key, value]) => params[key] === value || (key === "sort" && !params.sort && value === "volume"))
          && Object.keys(params).every((key) => key in presetParams);
        return <Link key={item.label} href={pageHref("/registry/markets", presetParams, 1, pageSize)} aria-current={selected ? "true" : undefined} className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 ${selected ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-raised"}`}>{item.label}</Link>;
      })}
    </div>
      <p className="mt-2 w-full text-[12px] leading-5 text-ink-soft">Filters combine. Activity uses the selected pool&apos;s complete 24-hour window. V3 quote holdings and V4 depth measure different things.</p>
  </div>;
}
