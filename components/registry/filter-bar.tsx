import Form from "next/form";
import Link from "@/components/ui/navigation-link";
import { FilterMenu } from "@/components/registry/filter-menu";
import type { ReactElement } from "react";
import { ASSET_TYPE_LABEL, SORT_LABEL, STATE_FILTER_LABEL, defaultAssetSortOrder, type AssetSort, type AssetTypeFilter, type BrowseFilters, type StateFacets, type StateFilter } from "@/lib/registry/browse";

// One filter bar for both registry tables (the public page and the dashboard).
// Every control is a link or a GET form, so a filtered view has a URL that can
// be shared, indexed, or handed to an agent, and the page renders it without
// JavaScript.

interface FilterBarProps {
  basePath: string;
  filters: BrowseFilters;
  facets: StateFacets;
  typeCounts: Array<{ assetType: string; count: number }>;
  shown: number;
  pageSize?: 25 | 50;
}

const TYPE_ORDER: AssetTypeFilter[] = ["all", "stock_token", "bridged", "stablecoin", "wrapped_native"];
const STATE_ORDER: Exclude<StateFilter, "all">[] = ["feed", "paused", "halted", "pending", "stale", "residual", "divergent", "lookalikes"];
const SORT_ORDER: AssetSort[] = ["symbol", "name", "type", "address", "verified", "multiplier", "price", "lookalikes", "state", "newest"];

export function hrefFor(basePath: string, base: BrowseFilters, patch: Partial<BrowseFilters>, pageSize = 25): string {
  const next = { ...base, ...patch };
  if (patch.sort && patch.sort !== base.sort && patch.order === undefined) next.order = defaultAssetSortOrder(patch.sort);
  const params = new URLSearchParams();
  if (pageSize === 50) params.set("size", "50");
  if (next.q) params.set("q", next.q);
  if (next.type !== "all") params.set("type", next.type);
  if (next.verifiedOnly) params.set("verified", "1");
  if (next.state !== "all") params.set("state", next.state);
  if (next.sort !== "symbol") params.set("sort", next.sort);
  if (next.order !== defaultAssetSortOrder(next.sort)) params.set("order", next.order);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function isDefault(filters: BrowseFilters): boolean {
  return !filters.q && filters.type === "all" && !filters.verifiedOnly && filters.state === "all" && filters.sort === "symbol" && filters.order === "asc";
}

interface ActiveFilterProps {
  label: string;
  href: string;
}

export function ActiveFilter({ label, href }: ActiveFilterProps): ReactElement {
  return <Link href={href} scroll={false} prefetch={false} aria-label={`Remove ${label}`} className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[13px] text-ink hover:bg-panel">
    <span className="break-all">{label}</span><span aria-hidden="true">×</span>
  </Link>;
}

export function FilterBar({ basePath, filters, facets, typeCounts, shown, pageSize = 25 }: FilterBarProps): ReactElement {
  const total = typeCounts.reduce((sum, entry) => sum + entry.count, 0);
  const countByType = new Map(typeCounts.map((entry) => [entry.assetType, entry.count]));

  return (
    <div className="flex flex-col gap-2">
      <Form scroll={false} action={basePath} className="flex flex-wrap items-center gap-2">
        <input
          key={filters.q}
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Ticker, company, ISIN or address"
          aria-label="Search the registry"
          className="h-11 min-w-0 flex-1 sm:max-w-sm rounded-lg border border-line bg-raised px-5 text-[14px] text-ink placeholder:text-ink focus:border-hood/60 focus:outline-none"
        />
        {pageSize === 50 ? <input type="hidden" name="size" value="50" /> : null}
        {filters.type !== "all" ? <input type="hidden" name="type" value={filters.type} /> : null}
        {filters.verifiedOnly ? <input type="hidden" name="verified" value="1" /> : null}
        {filters.state !== "all" ? <input type="hidden" name="state" value={filters.state} /> : null}
        {filters.sort !== "symbol" ? <input type="hidden" name="sort" value={filters.sort} /> : null}
        <input type="hidden" name="order" value={filters.order} />
        <button type="submit" className="h-11 rounded-lg bg-ink px-5 text-[13.5px] font-medium text-paper">
          Search
        </button>
        <span className="ml-auto font-mono text-[12px] tabular-nums text-ink">
          {shown} matching of {total}
        </span>
      </Form>

      <div className="flex flex-wrap items-center gap-2" aria-label="Registry filters">
        <FilterMenu label="Type" value={filters.type === "all" ? "All assets" : ASSET_TYPE_LABEL[filters.type]} options={TYPE_ORDER.map(function typeOption(type) {
          return { label: type === "all" ? "All assets" : ASSET_TYPE_LABEL[type], href: hrefFor(basePath, filters, { type }, pageSize), active: filters.type === type, count: type === "all" ? total : countByType.get(type) ?? 0 };
        })} />
        <FilterMenu label="State" value={filters.state === "all" ? "All states" : STATE_FILTER_LABEL[filters.state]} options={[{ label: "All states", href: hrefFor(basePath, filters, { state: "all" }, pageSize), active: filters.state === "all" }, ...STATE_ORDER.map(function stateOption(state) {
          return { label: STATE_FILTER_LABEL[state], href: hrefFor(basePath, filters, { state }, pageSize), active: filters.state === state, count: facets[state] };
        })]} />
        <FilterMenu label="Sort" value={SORT_LABEL[filters.sort]} options={SORT_ORDER.map(function sortOption(sort) {
          return { label: SORT_LABEL[sort], href: hrefFor(basePath, filters, { sort }, pageSize), active: filters.sort === sort };
        })} />
        <FilterMenu label="Direction" value={filters.order === "asc" ? "Ascending" : "Descending"} options={[
          { label: "Ascending", href: hrefFor(basePath, filters, { order: "asc" }, pageSize), active: filters.order === "asc" },
          { label: "Descending", href: hrefFor(basePath, filters, { order: "desc" }, pageSize), active: filters.order === "desc" },
        ]} />
        <Link href={hrefFor(basePath, filters, { verifiedOnly: !filters.verifiedOnly }, pageSize)} aria-current={filters.verifiedOnly ? "true" : undefined} className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-[14px] ${filters.verifiedOnly ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-panel"}`}>
          <span aria-hidden="true">{filters.verifiedOnly ? "✓" : "+"}</span> Listing confirmed
        </Link>
      </div>
      {filters.sort === "holders" || filters.sort === "float" ? <p className="text-[13px] text-ink">This saved URL still sorts by {SORT_LABEL[filters.sort].toLowerCase()}. That metric is currently hidden; choose another sort to change the order.</p> : null}
      {!isDefault(filters) ? <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
        {filters.q ? <ActiveFilter label={`Search: ${filters.q}`} href={hrefFor(basePath, filters, { q: "" }, pageSize)} /> : null}
        {filters.type !== "all" ? <ActiveFilter label={`Type: ${ASSET_TYPE_LABEL[filters.type]}`} href={hrefFor(basePath, filters, { type: "all" }, pageSize)} /> : null}
        {filters.state !== "all" ? <ActiveFilter label={`State: ${STATE_FILTER_LABEL[filters.state]}`} href={hrefFor(basePath, filters, { state: "all" }, pageSize)} /> : null}
        {filters.verifiedOnly ? <ActiveFilter label="Listing confirmed" href={hrefFor(basePath, filters, { verifiedOnly: false }, pageSize)} /> : null}
        {filters.sort !== "symbol" ? <ActiveFilter label={`Sort: ${SORT_LABEL[filters.sort]}`} href={hrefFor(basePath, filters, { sort: "symbol", order: "asc" }, pageSize)} /> : null}
        <Link href={hrefFor(basePath, filters, { q: "", type: "all", state: "all", verifiedOnly: false, sort: "symbol", order: "asc" }, pageSize)} className="inline-flex min-h-11 items-center px-2 py-1.5 text-[13px] text-ink underline underline-offset-4">Reset all</Link>
      </div> : null}
    </div>
  );
}
