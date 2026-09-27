import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { test } from "node:test";
import { cachedJson } from "@/lib/api/etag";
import { marketCacheSeconds } from "./market-cache";

test("market cache cannot carry published fields beyond the oldest freshness boundary", function expiry() {
  const now = 1_000_000;
  assert.equal(marketCacheSeconds([{ stateCheckedAt: new Date(now - 598_500) }], now), 1);
  assert.equal(marketCacheSeconds([{ stateCheckedAt: new Date(now), metricsAsOf: new Date(now - 120_000) }], now), 0);
  assert.equal(marketCacheSeconds([{ stateCheckedAt: null, metricsAsOf: new Date(now - 110_000) }], now), 10);
  const response = cachedJson(new Request("https://fletch.now/api/v1/status"), { checkedAt: "fixture" }, 0, false);
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
});
