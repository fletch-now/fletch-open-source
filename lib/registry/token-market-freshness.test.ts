import assert from "node:assert/strict";
import { test } from "node:test";
import { capitalizationMetric, observedMetric } from "./metric-observation";
import { revalidateMetric, revalidateTokenMarket } from "./token-market-freshness";
import type { TokenMarket } from "./token-markets-types";

const now = Date.parse("2026-09-10T20:00:00Z");
const at = new Date(now - 1000).toISOString();
function number(value: number, maxAgeMs = 10_000) {
  return observedMetric(value, "Pinned RPC", at, null, { maxAgeMs, fetchedAt: at, blockNumber: "10", blockHash: "0x123" }, now);
}

test("response projection expires compound inputs after an awaited read without rewriting provenance", function () {
  const decimals = number(2);
  const supply = observedMetric("1000", "Supply", at, null, { maxAgeMs: 2000 }, now);
  const burn = observedMetric("100", "Burn balances", at, null, { maxAgeMs: 10_000 }, now);
  const price = number(2);
  const original = capitalizationMetric(decimals, supply, burn, price, now);
  assert.equal(original.value, 18);
  const projected = revalidateMetric(original, now + 1500);
  assert.equal(projected.value, null);
  assert.equal(projected.observation.status, "stale");
  assert.match(projected.reason ?? "", /expired/);
  const expiredInput = projected.observation.inputs.find((input) => input.name === "totalSupplyRaw")!;
  assert.equal(expiredInput.value, null);
  assert.equal(expiredInput.observation.status, "stale");
  assert.equal(projected.observation.inputs.find((input) => input.name === "priceUsd")!.value, 2);
  assert.equal(projected.asOf, original.asOf);
  assert.equal(projected.observation.expiresAt, original.observation.expiresAt);
  assert.equal(expiredInput.observation.readStatus, "ok", "Expiration does not invent a failed RPC read");
  assert.equal(original.value, 18, "Projection must not mutate a reusable reading");
});

test("response projection retains current zero and failed-read evidence, and never revives missing values", function () {
  const zero = number(0);
  assert.deepEqual(revalidateMetric(zero, now + 1), zero);
  const retained = { ...zero, reason: "RPC failed", observation: { ...zero.observation, readStatus: "failed" as const } };
  assert.deepEqual(revalidateMetric(retained, now + 1), retained);
  const missing = observedMetric<number>(null, null, null, "Unread", {}, now);
  assert.deepEqual(revalidateMetric(missing, now + 100_000), missing);
  const expired = revalidateMetric(retained, now + 10_000);
  assert.equal(expired.value, null);
  assert.equal(expired.reason, "RPC failed");
  assert.equal(expired.observation.fetchedAt, at);
  assert.equal(expired.observation.blockHash, "0x123");
});

test("token response projects all compatibility metrics and expires dominance at the recorded policy boundary", function () {
  const raw = observedMetric("100", "Supply", at, null, { maxAgeMs: 2000 }, now);
  const row: TokenMarket = { chainId: 4663, address: "0x123", assetId: null, symbol: "TEST", name: "Test", trust: "community",
    dominantAddress: "0x123", selectionReason: "Recorded comparison", closeCall: false, alternatives: [], bestPoolId: "pool", poolCount: 1,
    selection: { selectedAt: at, expiresAt: new Date(now + 1000).toISOString(), policy: "test", status: "current" },
    decimals: number(18), totalSupplyRaw: raw, burnedRaw: raw, metadataReason: null, volumeScope: "selected_pool",
    priceUsd: number(2, 2000), marketCapUsd: number(20, 2000), volumeUsd24h: number(0), swaps24h: number(0), transactions24h: number(0),
    holders: number(100), v3QuoteHoldingsUsd: number(5000, 2000), v4OnePercentDepthUsd: number(0) };
  const result = revalidateTokenMarket(row, now + 1500);
  assert.equal(result.priceUsd.value, null);
  assert.equal(result.marketCapUsd.value, null);
  assert.equal(result.v3QuoteHoldingsUsd.value, null);
  assert.equal(result.totalSupplyRaw.value, null);
  assert.equal(result.burnedRaw.value, null);
  assert.equal(result.volumeUsd24h.value, 0);
  assert.equal(result.selection.status, "stale");
  assert.equal(result.dominantAddress, null);
  assert.equal(row.dominantAddress, "0x123");
  const alreadyStale = revalidateTokenMarket({ ...row, selection: { ...row.selection, status: "stale" } }, now);
  assert.equal(alreadyStale.selection.status, "stale");
  assert.equal(alreadyStale.dominantAddress, null);
});
