import assert from "node:assert/strict";
import { test } from "node:test";
import { formatTelegram } from "./format";
import type { DeliveryPayload, TrustStamp } from "./types";

function transfer(trust?: TrustStamp): DeliveryPayload {
  return {
    kind: "large_transfer",
    chainId: 4663,
    address: "0x1111111111111111111111111111111111111111",
    symbol: "TSLA",
    name: "Tesla",
    decimals: 18,
    from: "0x2222222222222222222222222222222222222222",
    to: "0x3333333333333333333333333333333333333333",
    value: "1000000000000000000",
    amount: "1",
    threshold: "0",
    txHash: "0x44",
    logIndex: 0,
    blockNumber: "1",
    blockHash: "0x55",
    explorerUrl: "https://explorer.example/tx/0x44",
    trust,
  };
}

test("a verified token says so on the alert", function () {
  assert.match(formatTelegram(transfer({ level: "verified", impersonates: null })), /Verified — on Robinhood's list/);
});

test("a lookalike alert names the token it imitates and the verified address", function () {
  const message = formatTelegram(transfer({ level: "lookalike", impersonates: { symbol: "TSLA", address: "0xaaaa" } }));
  assert.match(message, /LOOKALIKE of TSLA/);
  assert.match(message, /NOT the verified token/);
  assert.match(message, /Verified address: 0xaaaa/);
});

test("a community token is labelled unverified, never verified", function () {
  const message = formatTelegram(transfer({ level: "community", impersonates: null }));
  assert.match(message, /Community token/);
  assert.doesNotMatch(message, /Verified/);
});

test("an alert raised before trust stamps existed reads exactly as it did", function () {
  const message = formatTelegram(transfer());
  assert.doesNotMatch(message, /Verified|LOOKALIKE|Community|Unknown token/);
  assert.match(message, /Sequencer-confirmed/);
});

function newPool(overrides: Partial<Extract<DeliveryPayload, { kind: "new_pool" }>> = {}): DeliveryPayload {
  return {
    kind: "new_pool",
    chainId: 4663,
    poolId: "0xpool",
    venue: "uniswap_v4",
    tokenAddress: "0x1111111111111111111111111111111111111111",
    symbol: "PIPE",
    name: "Pipe Dog",
    quote: "USDG",
    priceUsd: "0.25",
    depthUsd: "12500",
    createdBlock: "10",
    firstSeenAt: "2026-09-06T00:00:00.000Z",
    tokenUrl: "https://fletch.now/registry/token/0x1111111111111111111111111111111111111111",
    explorerUrl: null,
    ...overrides,
  };
}

test("a new pool alert names the pair, the venue and what was read", function () {
  const message = formatTelegram(newPool());
  assert.match(message, /New pool: PIPE \/ USDG/);
  assert.match(message, /uniswap v4/);
  assert.match(message, /depth \$12\.5K/);
});

test("a new pool nobody has priced shows a dash, never a zero", function () {
  const message = formatTelegram(newPool({ priceUsd: null, depthUsd: null }));
  assert.match(message, /price — · depth —/);
  assert.doesNotMatch(message, /\$0/);
});

test("a new pool whose token imitates a listing carries the warning", function () {
  const message = formatTelegram(newPool({ symbol: "TSLA", trust: { level: "lookalike", impersonates: { symbol: "TSLA", address: "0xaaaa" } } }));
  assert.match(message, /LOOKALIKE of TSLA/);
  assert.match(message, /Verified address: 0xaaaa/);
});
