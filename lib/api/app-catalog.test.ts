import assert from "node:assert/strict";
import { test } from "node:test";
import { appCatalogPage, appCatalogQuery } from "./app-catalog";
import type { CatalogReading } from "@/lib/registry/app-catalog";
import type { CatalogPair } from "@/lib/registry/app-catalog-model";

function pair(symbol: string, tradable = false): CatalogPair {
  return { id: symbol, symbol: `${symbol}-USD`, display_only: !tradable,
    tradability: tradable ? "tradable" : "untradable", tradability_by_account_type: { individual: tradable ? "tradable" : "untradable", ira_roth: "untradable" },
    is_stablecoin: false, min_order_size: "1.0", max_order_size: tradable ? "900000" : "1.0",
    asset_currency: { id: symbol, code: symbol, name: `${symbol} token`, display_only: !tradable }, quote_currency: { code: "USD" } };
}

test("catalog pagination retains unmatched symbols, account fields and stale source evidence", function catalog() {
  const reading: CatalogReading = { source: "https://nummus.robinhood.com/currency_pairs/", observedAt: "2026-09-13T20:00:00.000Z", ageSeconds: 90, stale: true, error: "Source HTTP 403", pairs: [pair("PONS"), pair("FRONG"), pair("CASHCAT", true)] };
  const first = appCatalogPage(reading, 4663, appCatalogQuery(new URLSearchParams("limit=2")));
  assert.deepEqual(first.items.map((item) => item.symbol), ["CASHCAT", "FRONG"]);
  assert.equal(first.nextOffset, 2);
  assert.equal(first.total, 3);
  assert.equal(first.stale, true);
  assert.equal(first.error, "Source HTTP 403");
  assert.equal(first.ageSeconds, 90);
  assert.equal(first.items[0].status, "tradable");
  assert.equal(first.items[0].pairs[0].tradability_by_account_type.ira_roth, "untradable");
  assert.equal(first.items[1].status, "display_only");
  assert.match(first.items[1].marketsUrl, /q=FRONG$/);
  const last = appCatalogPage(reading, 4663, appCatalogQuery(new URLSearchParams("limit=2&offset=2")));
  assert.deepEqual(last.items.map((item) => item.symbol), ["PONS"]);
  assert.equal(last.nextOffset, null);
  assert.equal(appCatalogPage(reading, 4663, appCatalogQuery(new URLSearchParams("status=tradable&q=token"))).total, 1);
  assert.equal(appCatalogPage(reading, 4663, appCatalogQuery(new URLSearchParams("q=missing"))).total, 0);
});

test("catalog rejects ambiguous and unbounded queries", function queries() {
  for (const query of ["limit=201", "limit=0", "offset=-1", "offset=1.5", "limit=1e2", "status=listed", "q=a&q=b", "unknown=x", "q=" + "x".repeat(129)]) {
    assert.throws(() => appCatalogQuery(new URLSearchParams(query)), Error, query);
  }
});
