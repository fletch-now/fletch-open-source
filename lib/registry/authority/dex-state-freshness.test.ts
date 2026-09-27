import assert from "node:assert/strict";
import { test } from "node:test";
import { stateReadIsCurrent, POOL_STATE_FRESH_MS } from "./dex-state-freshness";
import { pricingIsMeaningful, publicPool } from "./shape";
import type { DexPool, DexToken } from "./dex";

const now = Date.parse("2026-09-08T12:00:00Z");
const tokenAddress = `0x${"1".repeat(40)}`;
const pool = {
  id: "fixture", stateCheckedAt: new Date(now), depthUsd: "1000", priceUsd: "2", priceInQuote: "2", tokenAddress,
  fee: 3000, createdBlock: BigInt(1), sqrtPriceX96: "1", tick: 1, liquidity: "100", lastSwapAt: null,
} as DexPool;
const token = { address: tokenAddress, totalSupplyRaw: "1000", decimals: 0, burnedRaw: "0", checkedAt: new Date(now), supplyCheckedAt: new Date(now) } as DexToken;

test("pool state freshness includes its exact cadence boundary and rejects absent, future and invalid observations", function () {
  assert.equal(stateReadIsCurrent(new Date(now - POOL_STATE_FRESH_MS), now), true);
  for (const at of [null, new Date(now - POOL_STATE_FRESH_MS - 1), new Date(now + 1), new Date("invalid")]) {
    assert.equal(stateReadIsCurrent(at, now), false);
  }
});

test("stale high depth cannot publish prices, valuations or current state", function () {
  const tokens = new Map([[tokenAddress, token]]);
  const current = publicPool(pool, new Map(), tokens, 100, now);
  assert.equal(current.stateCurrent, true);
  assert.equal(current.pricePublished, true);
  assert.equal(current.priceUsd, 2);
  assert.equal(current.token?.fdvUsd, 2000);
  for (const stateCheckedAt of [null, new Date(now - POOL_STATE_FRESH_MS - 1), new Date(now + 1)]) {
    const stale = { ...pool, stateCheckedAt, depthUsd: "999999999" };
    assert.equal(pricingIsMeaningful(stale, 100, now), false);
    const result = publicPool(stale, new Map(), tokens, 100, now);
    assert.equal(result.stateCurrent, false);
    assert.equal(result.pricePublished, false);
    for (const value of [result.depthUsd, result.priceUsd, result.priceInQuote, result.sqrtPriceX96, result.tick, result.liquidity, result.token?.fdvUsd, result.token?.marketCapUsd]) assert.equal(value, null);
    assert.equal(result.stateCheckedAt, stateCheckedAt?.toISOString() ?? null);
    assert.equal(stale.depthUsd, "999999999", "publishing must preserve the stored observation");
  }
  assert.equal(pricingIsMeaningful({ ...pool, depthUsd: "99" }, 100, now), false);
  assert.equal(pricingIsMeaningful({ ...pool, priceUsd: "NaN", priceInQuote: null }, 100, now), false);
});


test("a current pool cannot rejuvenate stale or unread supply in legacy pool capitalization", function () {
  for (const supplyCheckedAt of [null, new Date(now - 300_001), new Date(now + 1)]) {
    const result = publicPool(pool, new Map(), new Map([[tokenAddress, { ...token, supplyCheckedAt }]]), 100, now);
    assert.equal(result.priceUsd, 2);
    assert.equal(result.token?.fdvUsd, null);
    assert.equal(result.token?.marketCapUsd, null);
    assert.equal(result.token?.supplyCurrent, false);
    assert.equal(result.token?.supplyReadAt, supplyCheckedAt?.toISOString() ?? null);
  }
});
