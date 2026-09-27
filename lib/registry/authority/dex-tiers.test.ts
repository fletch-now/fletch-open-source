import assert from "node:assert/strict";
import { test } from "node:test";
import { tierOf } from "./dex-tiers";

const now = new Date("2026-09-05T12:00:00Z");
const days = (n: number): Date => new Date(now.getTime() - n * 24 * 60 * 60_000);

test("depth or a recent swap keeps a pool active", function () {
  assert.equal(tierOf({ depthUsd: 500, liquidity: BigInt(1), lastSwapAt: null, firstSeenAt: days(10), stateCheckedAt: days(1), now }), "active");
  assert.equal(tierOf({ depthUsd: 1, liquidity: BigInt(1), lastSwapAt: days(2), firstSeenAt: days(10), stateCheckedAt: days(1), now }), "active");
});

test("a pool the state read has not looked at is active until it has", function () {
  assert.equal(tierOf({ depthUsd: null, liquidity: null, lastSwapAt: null, firstSeenAt: days(0.5), stateCheckedAt: null, now }), "active");
  assert.equal(tierOf({ depthUsd: 0, liquidity: BigInt(0), lastSwapAt: null, firstSeenAt: days(0.5), stateCheckedAt: days(0.1), now }), "dormant");
});

test("drained or empty with no swap in a month is dormant", function () {
  assert.equal(tierOf({ depthUsd: 0, liquidity: BigInt(0), lastSwapAt: days(45), firstSeenAt: days(90), stateCheckedAt: days(1), now }), "dormant");
  assert.equal(tierOf({ depthUsd: 3, liquidity: BigInt(9), lastSwapAt: null, firstSeenAt: days(90), stateCheckedAt: days(1), now }), "dormant");
});

test("a little depth with no recent swap is quiet", function () {
  assert.equal(tierOf({ depthUsd: 40, liquidity: BigInt(9), lastSwapAt: days(20), firstSeenAt: days(90), stateCheckedAt: days(1), now }), "quiet");
});
