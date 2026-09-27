import { observedMetric } from "./metric-observation";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pageHref, readPage, RegistryPagination } from "@/components/registry/pagination";
import { marketNumber, metricReason, tokenSupply, TokenMetric, volumeBasis } from "@/components/registry/token-metric";
import { lookalikeReason } from "@/components/registry/lookalike-reason";

test("reader pages are bounded and filter links preserve the selected view", function pagination() {
  for (const page of [undefined, "0", "-2", "2.5", "Infinity", "1000001", ["2", "3"]]) {
    assert.deepEqual(readPage({ page }), { page: 1, pageSize: 25, offset: 0 });
  }
  assert.deepEqual(readPage({ page: "3", size: "50" }), { page: 3, pageSize: 50, offset: 100 });
  assert.equal(readPage({ size: "1000" }).pageSize, 25);
  const url = new URL(pageHref("/registry/markets", { q: "CASHCAT", sort: "volume", view: "pools", page: "1", size: "25" }, 2, 50), "https://fixture.invalid");
  assert.equal(url.searchParams.get("q"), "CASHCAT");
  assert.equal(url.searchParams.get("view"), "pools");
  assert.equal(url.searchParams.get("sort"), "volume");
  assert.equal(url.searchParams.get("page"), "2");
  assert.equal(url.searchParams.get("size"), "50");
  const first = renderToStaticMarkup(createElement(RegistryPagination, { basePath: "/registry", params: {}, page: 1, pageSize: 25, total: 63 }));
  assert.match(first, /1–25 of 63/);
  assert.doesNotMatch(first, /rel="prev"/);
  assert.match(first, /rel="next"/);
  const last = renderToStaticMarkup(createElement(RegistryPagination, { basePath: "/registry", params: {}, page: 3, pageSize: 25, total: 63 }));
  assert.match(last, /51–63 of 63/);
  assert.doesNotMatch(last, /rel="next"/);
});

test("market cells distinguish measured zero from missing values and retain source evidence", function metrics() {
  assert.equal(tokenSupply("123456789012345678901234567890", 18), "123,456,789,012.34567890123456789");
  assert.equal(tokenSupply("0", 0), "0");
  assert.equal(tokenSupply("100.000", 2), "1");
  assert.equal(tokenSupply("100", null), "Unavailable");
  assert.equal(volumeBasis("Selected pool. USDG denomination: 1 USDG = 1 USD"), "USDG notional");
  assert.equal(volumeBasis("Historical window-start Chainlink ETH/USD estimate"), "historical oracle estimate");
  assert.equal(volumeBasis(null), null);
  assert.equal(metricReason("unsupported_quote_currency"), "This quote currency has no supported USD valuation.");
  assert.equal(marketNumber(null), "Unavailable");
  assert.equal(marketNumber(Number.NaN), "Unavailable");
  assert.equal(marketNumber(0), "$0.00");
  assert.equal(marketNumber(0, false), "0");
  assert.notEqual(marketNumber(0.000015), "$0.00");
  const html = renderToStaticMarkup(createElement(TokenMetric, { metric: observedMetric(null, "Historical swaps", "2026-09-09T16:00:00Z", "USD quote history is incomplete.") }));
  assert.match(html, /Unavailable/);
  assert.match(html, /Historical swaps/);
  assert.match(html, /2026-09-09T16:00:00.000Z/);
  assert.match(html, /USD quote history is incomplete/);
  assert.doesNotMatch(html, /\$0/);
});

test("name-collision explanations describe the recorded check without alleging fraud", function collisions() {
  for (const kind of ["same_ticker", "impostor", "unverified", "unlisted_stock"]) {
    const text = lookalikeReason({ kind, exactName: true });
    assert.doesNotMatch(text, /fake|fraud|impostor|verified token/i);
    assert.ok(text.length > 15);
  }
});
