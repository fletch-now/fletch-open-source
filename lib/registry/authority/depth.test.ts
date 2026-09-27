import assert from "node:assert/strict";
import { test } from "node:test";
import { marketCapUsd, onePctDepthUsd, usdOf, withinVenueHoldings } from "@/lib/registry/authority/depth";

const USDG = { address: "0x5fc5360d0400a0fd4f2af552add042d716f1d168", decimals: 6 };
const TOKEN = "0xa9615db578ac13d52eb9e100d22e9f6b3548df3d";
const Q96 = BigInt(2) ** BigInt(96);

test("a balance is priced through the quote's decimals, not the token's", function () {
  assert.equal(usdOf(BigInt(1_500_000), USDG, 1), 1.5);
  assert.equal(usdOf(BigInt("2000000000000000000"), { address: "0x0", decimals: 18 }, 4000), 8000);
});

test("no price, no liquidity, no depth", function () {
  assert.equal(onePctDepthUsd(TOKEN, USDG, BigInt(0), BigInt(1000), 1), null);
  assert.equal(onePctDepthUsd(TOKEN, USDG, Q96, BigInt(0), 1), null);
});

test("the estimate is dropped when it exceeds what the venue holds", function () {
  // The launchpad clone that showed $13,768,847,450 of depth against a
  // PoolManager holding a few million dollars of USDG.
  assert.equal(withinVenueHoldings(13_768_847_450, 4_000_000), null);
  assert.equal(withinVenueHoldings(120_000, 4_000_000), 120_000);
  assert.equal(withinVenueHoldings(null, 4_000_000), null);
});

test("a depth estimate requires a successful finite holdings check", function () {
  assert.equal(withinVenueHoldings(500, null), null);
  assert.equal(withinVenueHoldings(500, NaN), null);
  assert.equal(withinVenueHoldings(Infinity, 500), null);
});

test("two pools holding the same liquidity at the same price do read the same, and that is the launchpad, not a bug", function () {
  const first = onePctDepthUsd(TOKEN, USDG, Q96, BigInt("11224406758565465756598"), 1);
  const second = onePctDepthUsd(TOKEN, USDG, Q96, BigInt("11224406758565465756598"), 1);
  assert.equal(first, second);
  // What must not survive is the pair of them being published above what the
  // venue holds: that is the identical-depth-in-the-billions row.
  assert.equal(withinVenueHoldings(first, 1_000_000), null);
});

test("market cap prices supply the burn addresses no longer hold", function () {
  const token = { totalSupplyRaw: "1000000000000000000000", burnedRaw: "400000000000000000000", decimals: 18 };
  assert.equal(marketCapUsd(token, 2), 1200);
});

test("market cap is blank when supply, burn or decimals were not read", function () {
  assert.equal(marketCapUsd({ totalSupplyRaw: "1000", burnedRaw: null, decimals: 18 }, 2), null);
  assert.equal(marketCapUsd({ totalSupplyRaw: null, burnedRaw: "0", decimals: 18 }, 2), null);
  assert.equal(marketCapUsd({ totalSupplyRaw: "1000", burnedRaw: "0", decimals: null }, 2), null);
  assert.equal(marketCapUsd({ totalSupplyRaw: "1000", burnedRaw: "0", decimals: 18 }, null), null);
});

test("a confirmed zero outstanding supply renders zero", function () {
  assert.equal(marketCapUsd({ totalSupplyRaw: "1000", burnedRaw: "1000", decimals: 18 }, 2), 0);
  assert.equal(marketCapUsd({ totalSupplyRaw: "1000", burnedRaw: "1001", decimals: 18 }, 2), null);
});

test("supply subtraction retains small outstanding balances beside large burn totals", function () {
  const supply = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
  const burned = (BigInt(supply) - BigInt(1)).toString();
  assert.equal(marketCapUsd({ totalSupplyRaw: supply, burnedRaw: burned, decimals: 0 }, 2), 2);
  assert.equal(marketCapUsd({ totalSupplyRaw: "invalid", burnedRaw: "0", decimals: 18 }, 2), null);
});
