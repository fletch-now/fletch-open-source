import assert from "node:assert/strict";
import { test } from "node:test";
import { historicalQuote, nominalUsdgQuote, quoteEvidence, SWAP_USDG, SWAP_WETH, swapQuoteAddress, valueSwap } from "./market-swap-valuation";

const start = { number: BigInt(100), timestamp: BigInt(100_000), hash: "canonical" };
const end = { number: BigInt(200), timestamp: BigInt(100_600), hash: "canonical-end" };
const round = [BigInt(8), BigInt(250012345678), BigInt(99_800), BigInt(99_900), BigInt(8)] as const;

test("USDG volume counts only the identified quote leg, with exact raw-unit precision", function () {
  const quote = nominalUsdgQuote();
  assert.equal(valueSwap(SWAP_USDG, SWAP_WETH, BigInt(-1234567), BigInt(999999999), quote), "1.234567");
  assert.equal(valueSwap(SWAP_WETH, SWAP_USDG, BigInt(999999999), BigInt(1234567), quote), "1.234567");
  assert.equal(valueSwap(SWAP_WETH, SWAP_USDG, BigInt(0), BigInt(0), quote), "0");
  assert.equal(swapQuoteAddress(4663, SWAP_WETH, SWAP_USDG), SWAP_USDG);
  assert.equal(swapQuoteAddress(46630, SWAP_USDG, SWAP_WETH), null);
  assert.equal(swapQuoteAddress(4663, "fake-USDG-symbol", "other"), null);
  assert.throws(() => valueSwap("other", "fake", BigInt(1), BigInt(1), quote), /not a pool currency/);
  assert.match(quoteEvidence(quote).source as string, /not a market-price observation/);
});

test("historical WETH estimate preserves archive sample and oracle time without floating point", function () {
  const quote = historicalQuote(start, end, "0xfeed", 8, round)!;
  assert.equal(valueSwap("token", SWAP_WETH, BigInt(1000), BigInt(-1_000_000_000_000_000_000), quote), "2500.12345678");
  assert.equal(quote.sampledBlock, "100");
  assert.equal(quote.sampledAt, new Date(100_000_000).toISOString());
  assert.equal(quote.oracleUpdatedAt, new Date(99_900_000).toISOString());
  assert.equal(quoteEvidence(quote).estimated, true);
});

test("future, stale, incomplete and non-positive oracle answers never value a historical swap", function () {
  assert.equal(historicalQuote(start, { ...end, timestamp: BigInt(103_601) }, "feed", 8, round), null);
  assert.equal(historicalQuote(start, end, "feed", 8, [BigInt(8), BigInt(1), BigInt(0), BigInt(96_999), BigInt(8)]), null);
  assert.equal(historicalQuote(start, end, "feed", 8, [BigInt(8), BigInt(1), BigInt(0), BigInt(100_001), BigInt(8)]), null);
  assert.equal(historicalQuote(start, end, "feed", 8, [BigInt(8), BigInt(1), BigInt(0), BigInt(99_900), BigInt(7)]), null);
  assert.equal(historicalQuote(start, end, "feed", 8, [BigInt(8), BigInt(0), BigInt(0), BigInt(99_900), BigInt(8)]), null);
});

test("a published feed heartbeat is explicit, bounded and inclusive; missing metadata keeps the conservative fallback", function () {
  const timed = [BigInt(8), BigInt(250000000000), BigInt(0), end.timestamp - BigInt(86400), BigInt(8)] as const;
  const quote = historicalQuote(start, end, "0xfeed", 8, timed, 86400);
  assert.ok(quote);
  assert.equal(quote.maxOracleAgeSeconds, 86400);
  assert.equal(quote.heartbeatSource, "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json");
  assert.equal(historicalQuote(start, { ...end, timestamp: end.timestamp + BigInt(1) }, "0xfeed", 8, timed, 86400), null);
  assert.equal(historicalQuote(start, end, "0xfeed", 8, timed), null);
  assert.equal(historicalQuote(start, end, "0xfeed", 8, timed, 86401), null);
  assert.equal(historicalQuote(start, end, "0xfeed", 8, timed, -1), null);
});
