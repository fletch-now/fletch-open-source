import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterBar, hrefFor } from "./filter-bar";
import { pageHref, RegistryPagination } from "./pagination";
import type { BrowseFilters, StateFacets } from "@/lib/registry/browse";

const base: BrowseFilters = { q: "ACME & Co", type: "stock_token", state: "paused", sort: "price", order: "desc", verifiedOnly: true };
const facets: StateFacets = { feed: 2, paused: 3, halted: 0, pending: 0, stale: 0, residual: 0, divergent: 0, lookalikes: 0 };

function query(href: string): URLSearchParams {
  return new URL(href, "https://fixture.invalid").searchParams;
}

test("removing each active filter preserves all remaining selections and page size", function removeFilters() {
  const original = query(hrefFor("/registry", base, {}, 50));
  for (const [field, reset, key] of [["q", "", "q"], ["type", "all", "type"], ["state", "all", "state"], ["sort", "symbol", "sort"], ["verifiedOnly", false, "verified"]] as const) {
    const next = query(hrefFor("/registry", base, { [field]: reset }, 50));
    assert.equal(next.has(key), false);
    for (const [otherKey, value] of original) if (otherKey !== key) assert.equal(next.get(otherKey), value);
    assert.equal(next.has("page"), false);
  }
});

test("changing order preserves exact escaped search and reset retains rows preference", function order() {
  const next = query(hrefFor("/registry", base, { sort: "newest" }, 50));
  assert.equal(next.get("q"), "ACME & Co");
  assert.equal(next.get("sort"), "newest");
  assert.equal(next.get("state"), "paused");
  assert.equal(hrefFor("/registry", base, { q: "", type: "all", state: "all", verifiedOnly: false, sort: "symbol" }, 50), "/registry?size=50");
});

test("rendered controls have explicit current selections, removable chips and real no-JS links", function controls() {
  const html = renderToStaticMarkup(<FilterBar basePath="/registry" filters={base} facets={facets} typeCounts={[{ assetType: "stock_token", count: 5 }]} shown={2} pageSize={50} />);
  assert.match(html, /aria-label="Type:/);
  assert.match(html, /aria-label="State:/);
  assert.match(html, /aria-label="Sort:/);
  assert.match(html, /aria-label="Remove Search: ACME &amp; Co"/);
  assert.match(html, /aria-label="Remove Listing confirmed"/);
  assert.match(html, /<noscript><details/);
  assert.match(html, /name="size" value="50"/);
  assert.match(html, /Reset all/);
  assert.doesNotMatch(html, /<select|sort=holders|sort=float|>Holders</);
});

test("independent issuer document pages preserve other groups and reset only their own page", function groups() {
  const params = { filings: "3", notices: "4", q: "Issuer", size: "50" };
  const next = query(pageHref("/registry/issuer/example", params, 2, 50, "filings"));
  assert.equal(next.get("filings"), "2");
  assert.equal(next.get("notices"), "4");
  assert.equal(next.get("q"), "Issuer");
  const first = query(pageHref("/registry/issuer/example", params, 1, 25, "filings"));
  assert.equal(first.has("filings"), false);
  assert.equal(first.get("notices"), "4");
  assert.equal(first.has("size"), false);
  const html = renderToStaticMarkup(<RegistryPagination basePath="/registry/issuer/example" params={params} page={3} pageSize={50} total={200} pageParam="filings" anchor="documents" />);
  assert.match(html, /filings=4/);
  assert.match(html, /#documents/);
  assert.doesNotMatch(html, /[?&amp;]page=/);
});


test("legacy hidden-metric order remains explicit without offering new hidden sorts", function legacyOrder() {
  for (const sort of ["holders", "float"] as const) {
    const html = renderToStaticMarkup(<FilterBar basePath="/registry" filters={{ ...base, sort }} facets={facets} typeCounts={[]} shown={0} />);
    assert.match(html, /This saved URL still sorts by/);
    assert.match(html, /That metric is currently hidden/);
    assert.match(html, new RegExp(`name="sort" value="${sort}"`));
    assert.match(html, /Reset all/);
  }
});


test("direction survives filtering and pagination while a new sort uses its own default", function direction() {
  const ascending = { ...base, order: "asc" as const };
  assert.equal(query(hrefFor("/registry", ascending, { q: "NEW" })).get("order"), "asc");
  assert.equal(query(pageHref("/registry", { sort: "price", order: "asc" }, 2, 25)).get("order"), "asc");
  assert.equal(query(hrefFor("/registry", ascending, { sort: "lookalikes" })).has("order"), false);
  assert.equal(query(hrefFor("/registry", base, { sort: "symbol", order: "desc" })).get("order"), "desc");
});
