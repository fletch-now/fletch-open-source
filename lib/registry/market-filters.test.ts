import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTokenMarkets, MARKET_FILTER_CONTRACT, MARKET_FILTER_KEYS, MARKET_FILTERS, tokenMatchesMarketFilters } from "./market-filters";
import type { Metric, TokenMarket } from "./token-markets-types";
import { tokenMarketParams, tokenMarketQuery } from "../api/token-market-query";
import { observedMetric } from "./metric-observation";
import { openApiDocument } from "../api/openapi";

function metric(value: number | null): Metric<number> {
  return observedMetric(value, "controlled indexed fixture", "2026-09-10T00:00:00.000Z", value === null ? "Observation unavailable" : null, {}, Date.parse("2026-09-10T00:00:00Z"));
}
function token(address: string, changes: Partial<TokenMarket> = {}): TokenMarket {
  return { chainId: 4663, address, assetId: null, symbol: "TEST", name: "Test", trust: "community", dominantAddress: address,
    selectionReason: "Fixture comparison", selection: { selectedAt: null, expiresAt: null, policy: "fixture", status: "missing" }, closeCall: false, alternatives: [], bestPoolId: "pool", poolCount: 2,
    decimals: metric(18), totalSupplyRaw: { ...metric(100), value: "100" }, burnedRaw: { ...metric(0), value: "0" }, metadataReason: null,
    volumeScope: "selected_pool", priceUsd: metric(2), marketCapUsd: metric(200), volumeUsd24h: metric(10), swaps24h: metric(1), transactions24h: metric(1), holders: metric(null),
    v3QuoteHoldingsUsd: metric(null), v4OnePercentDepthUsd: metric(null), ...changes };
}

test("numeric market filters preserve the difference between unavailable and measured zero", function () {
  const missing = token("missing", { volumeUsd24h: metric(null), swaps24h: metric(null), priceUsd: metric(null), marketCapUsd: metric(null) });
  const zero = token("zero", { volumeUsd24h: metric(0), swaps24h: metric(0), priceUsd: metric(0), marketCapUsd: metric(0) });
  for (const query of [{ activity: "quiet" }, { data: "complete" }, { minVolumeUsd: 0 }] as const) {
    assert.equal(tokenMatchesMarketFilters(missing, query), false);
    assert.equal(tokenMatchesMarketFilters(zero, query), true);
  }
  assert.equal(tokenMatchesMarketFilters(zero, { activity: "traded" }), false);
  assert.equal(tokenMatchesMarketFilters(missing, {}), true);
});

test("swap thresholds and volume thresholds are inclusive and combine with identity", function () {
  const row = token("major", { swaps24h: metric(100), volumeUsd24h: metric(10_000) });
  assert.equal(tokenMatchesMarketFilters(row, { kind: "community", activity: "busy", minVolumeUsd: 10_000, trust: "community", identity: "dominant" }), true);
  assert.equal(tokenMatchesMarketFilters(row, { activity: "busy", minVolumeUsd: 10_001 }), false);
  assert.equal(tokenMatchesMarketFilters({ ...row, swaps24h: metric(99) }, { activity: "busy" }), false);
  assert.equal(tokenMatchesMarketFilters({ ...row, dominantAddress: "another" }, { identity: "dominant" }), false);
  assert.equal(tokenMatchesMarketFilters({ ...row, assetId: "issuer-row" }, { identity: "dominant" }), false);
});

test("V3 holdings cannot satisfy a V4 depth filter or influence V4 sorting", function () {
  const v3 = token("v3", { v3QuoteHoldingsUsd: metric(9e9) });
  const v4 = token("v4", { v4OnePercentDepthUsd: metric(1_000) });
  assert.equal(tokenMatchesMarketFilters(v3, { depth: "v4_1k" }), false);
  assert.equal(tokenMatchesMarketFilters(v4, { depth: "v3_10k" }), false);
  assert.equal(tokenMatchesMarketFilters(v4, { depth: "v4_1k" }), true);
  assert.deepEqual([v3, v4].sort((a, b) => compareTokenMarkets(a, b, "v4_depth")).map((row) => row.address), ["v4", "v3"]);
});

test("volume sort never falls back to depth and uses stable address ties", function () {
  const rows = [
    token("3", { name: "Zulu", volumeUsd24h: metric(null), v3QuoteHoldingsUsd: metric(9e9) }),
    token("2", { name: "Alpha", volumeUsd24h: metric(null) }),
    token("1", { name: "Zulu", volumeUsd24h: metric(0) }),
    token("0", { name: "Zulu", volumeUsd24h: metric(0) }),
  ];
  assert.deepEqual(rows.sort((a, b) => compareTokenMarkets(a, b, "volume")).map((row) => row.address), ["0", "1", "2", "3"]);
});

test("same-name and close-comparison filters use recorded facts without promoting trust", function () {
  const row = token("token", { trust: "lookalike", closeCall: true, alternatives: [{ address: "other", symbol: "TEST", name: "Test", reason: "fixture" }] });
  assert.equal(tokenMatchesMarketFilters(row, { identity: "same_name", trust: "lookalike" }), true);
  assert.equal(tokenMatchesMarketFilters(row, { identity: "close_call", trust: "verified" }), false);
  assert.equal(tokenMatchesMarketFilters(token("alone"), { identity: "same_name" }), false);
  assert.equal(row.trust, "lookalike");
});

test("every published option and preset parses and round-trips through the same query contract", function () {
  for (const key of MARKET_FILTER_KEYS) {
    for (const option of MARKET_FILTERS[key].options) {
      const parsed = tokenMarketQuery(new URLSearchParams({ [key]: option.value }));
      assert.deepEqual(tokenMarketQuery(tokenMarketParams(parsed)), parsed);
    }
  }
  for (const preset of MARKET_FILTER_CONTRACT.presets) tokenMarketQuery(new URLSearchParams(preset.query));
  const parsed = tokenMarketQuery(new URLSearchParams("q=%24CASHCAT&sort=swaps&kind=community&data=volume&activity=busy&depth=v4_1k&identity=close_call&minVolumeUsd=12.5"));
  assert.equal(parsed.query, "CASHCAT");
  assert.deepEqual(tokenMarketQuery(tokenMarketParams(parsed)), parsed);
});

test("invalid and duplicate filters fail instead of silently widening the result set", function () {
  for (const raw of ["activity=trending", "data=freshish", "depth=tvl", "identity=real", "sort=volume&sort=name", "trust=community&trust=verified", "minVolumeUsd=", "minVolumeUsd=-1", "minVolumeUsd=NaN", "minVolumeUsd=Infinity", "minVolumeUsd=1e6", "minVolumeUsd=1000000000001", "minVolumeUsd=0&minVolumeUsd=5"]) {
    assert.throws(() => tokenMarketQuery(new URLSearchParams(raw)), Error, raw);
  }
});

test("OpenAPI filter values exactly match the parser and discovery catalog", function () {
  const operation = openApiDocument.paths["/chains/{chainId}/markets"].get;
  for (const key of MARKET_FILTER_KEYS) {
    const parameter = operation.parameters.find((entry) => entry.name === key);
    assert.ok(parameter && "enum" in parameter.schema);
    assert.deepEqual(parameter.schema.enum, MARKET_FILTERS[key].options.map((option) => option.value));
  }
  assert.ok(openApiDocument.paths["/chains/{chainId}/markets/filters"].get);
});


test("price, volume, capitalization and pool counts sort both directions with nulls last and address ties", () => {
  const rows = [token("c", { priceUsd: metric(null), volumeUsd24h: metric(null), marketCapUsd: metric(null), poolCount: 0 }),
    token("b", { name: "Alpha", priceUsd: metric(2), volumeUsd24h: metric(2), marketCapUsd: metric(2), poolCount: 2 }),
    token("a", { name: "Zulu", priceUsd: metric(2), volumeUsd24h: metric(2), marketCapUsd: metric(2), poolCount: 2 }),
    token("d", { priceUsd: metric(1), volumeUsd24h: metric(1), marketCapUsd: metric(1), poolCount: 1 })];
  for (const sort of ["price", "volume", "market_cap"] as const) {
    assert.deepEqual([...rows].sort((a,b) => compareTokenMarkets(a,b,sort,"asc")).map(row=>row.address), ["d","a","b","c"]);
    assert.deepEqual([...rows].sort((a,b) => compareTokenMarkets(a,b,sort,"desc")).map(row=>row.address), ["a","b","d","c"]);
  }
  assert.deepEqual([...rows].sort((a,b)=>compareTokenMarkets(a,b,"pools","asc")).map(row=>row.address), ["c","d","a","b"]);
  assert.deepEqual([...rows].sort((a,b)=>compareTokenMarkets(a,b,"pools","desc")).map(row=>row.address), ["a","b","d","c"]);
  assert.ok(compareTokenMarkets(rows[1],rows[2],"name") < 0);
  assert.ok(compareTokenMarkets(rows[1],rows[2],"name","desc") > 0);
  for (const raw of ["order=sideways","order=asc&order=desc"]) assert.throws(()=>tokenMarketQuery(new URLSearchParams(raw)));
  const explicit = tokenMarketQuery(new URLSearchParams("sort=name&order=desc"));
  assert.equal(tokenMarketParams(explicit).get("order"), "desc");
});
