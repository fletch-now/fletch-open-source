// Run with: node --import tsx --test lib/watch/match.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesWatcher, thresholdToRaw } from "@/lib/watch/match";

const WALLET = "0xAbC0000000000000000000000000000000dEaD";
const OTHER = "0x1111111111111111111111111111111111111a";
const ANOTHER = "0x2222222222222222222222222222222222222b";

test("large_transfer: below threshold does not match", function () {
  const result = matchesWatcher(
    { kind: "large_transfer", wallet: null, thresholdRaw: BigInt(1000) },
    { from: OTHER, to: ANOTHER, value: BigInt(999) },
  );
  assert.deepEqual(result, { matched: false });
});

test("large_transfer: exactly at threshold matches, sender/receiver irrelevant", function () {
  const result = matchesWatcher(
    { kind: "large_transfer", wallet: null, thresholdRaw: BigInt(1000) },
    { from: OTHER, to: ANOTHER, value: BigInt(1000) },
  );
  assert.deepEqual(result, { matched: true });
  assert.equal(result.direction, undefined);
});

test("wallet_activity: transfer touching neither side of the watched wallet does not match", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(0) },
    { from: OTHER, to: ANOTHER, value: BigInt(5000) },
  );
  assert.deepEqual(result, { matched: false });
});

test("wallet_activity: wallet as sender matches with direction out", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(0) },
    { from: WALLET, to: OTHER, value: BigInt(1) },
  );
  assert.deepEqual(result, { matched: true, direction: "out" });
});

test("wallet_activity: wallet as receiver matches with direction in", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(0) },
    { from: OTHER, to: WALLET, value: BigInt(1) },
  );
  assert.deepEqual(result, { matched: true, direction: "in" });
});

test("wallet_activity: comparison is case-insensitive on both the watcher's wallet and the log's addresses", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET.toLowerCase(), thresholdRaw: BigInt(0) },
    { from: OTHER, to: WALLET.toUpperCase(), value: BigInt(1) },
  );
  assert.deepEqual(result, { matched: true, direction: "in" });
});

test("wallet_activity: threshold 0 matches every transfer touching the wallet, including a zero-value one", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(0) },
    { from: WALLET, to: OTHER, value: BigInt(0) },
  );
  assert.deepEqual(result, { matched: true, direction: "out" });
});

test("wallet_activity: touches the wallet but below a positive threshold does not match", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(1000) },
    { from: WALLET, to: OTHER, value: BigInt(999) },
  );
  assert.deepEqual(result, { matched: false });
});

test("wallet_activity: both sides equal the watched wallet still matches (self-transfer), direction out", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: WALLET, thresholdRaw: BigInt(0) },
    { from: WALLET, to: WALLET, value: BigInt(1) },
  );
  assert.deepEqual(result, { matched: true, direction: "out" });
});

test("wallet_activity: no wallet configured on the watcher never matches", function () {
  const result = matchesWatcher(
    { kind: "wallet_activity", wallet: null, thresholdRaw: BigInt(0) },
    { from: WALLET, to: OTHER, value: BigInt(1) },
  );
  assert.deepEqual(result, { matched: false });
});

test("threshold scales to the token's own decimals, not an assumed eighteen", function () {
  assert.equal(thresholdToRaw("1000", 18), BigInt("1000000000000000000000"));
  assert.equal(thresholdToRaw("1000", 6), BigInt("1000000000"));
  assert.equal(thresholdToRaw("1000", 0), BigInt(1000));
});

test("a fraction the token cannot represent is truncated down, never rounded up", function () {
  assert.equal(thresholdToRaw("1.999999", 2), BigInt(199));
  assert.equal(thresholdToRaw("0.5", 1), BigInt(5));
});

test("a pasted six-decimal token matches on its own scale", function () {
  const watcher = { kind: "large_transfer" as const, wallet: null, thresholdRaw: thresholdToRaw("1000", 6) };
  assert.equal(matchesWatcher(watcher, { from: "0x1", to: "0x2", value: BigInt("999999999") }).matched, false);
  assert.equal(matchesWatcher(watcher, { from: "0x1", to: "0x2", value: BigInt("1000000000") }).matched, true);
});
