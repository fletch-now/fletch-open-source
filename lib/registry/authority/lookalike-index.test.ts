import assert from "node:assert/strict";
import { test } from "node:test";
import { localCollisionMatcher } from "./lookalikes";
import { foldTicker } from "../trust-rules";
import type { VerifiedAsset } from "../trust";

function asset(id: string, symbol: string, name: string): VerifiedAsset {
  return { id, symbol, name, address: `0x${id.padStart(40, "0")}`, assetType: "stock_token", decimals: 18 };
}

test("indexed collisions preserve first-listing order for duplicate and competing name/symbol matches", function matches() {
  const assets = [asset("1", "TSLA", "Tesla"), asset("2", "TWO", "Second"), asset("3", "ТSLA", "Tesla copy")];
  for (const verified of [assets, [...assets].reverse()]) {
    const match = localCollisionMatcher(verified);
    for (const token of [
      { symbol: "ТSLA", name: "Second" },
      { symbol: "TWO", name: "Tеsla" },
      { symbol: "", name: "Tesla copy" },
      { symbol: "OTHER", name: "Other" },
      { symbol: null, name: null },
      { symbol: " \u200b ", name: " \u200b " },
    ]) {
      const symbol = foldTicker(token.symbol);
      const name = foldTicker(token.name);
      const expected = verified.find((candidate) => (symbol && symbol === foldTicker(candidate.symbol)) || (name && name === foldTicker(candidate.name))) ?? null;
      assert.equal(match(token), expected);
    }
  }
});

test("resolved catalog matches do not reread or refold listing metadata per token", function catalog() {
  let reads = 0;
  const verified = Array.from({ length: 207 }, (_, index) => ({
    ...asset(String(index), `ASSET${index}`, `Asset ${index}`),
    get symbol(): string { reads += 1; return `ASSET${index}`; },
    get name(): string { reads += 1; return `Asset ${index}`; },
  }));
  const match = localCollisionMatcher(verified);
  assert.equal(reads, 414);
  for (let index = 0; index < 20_000; index += 1) {
    assert.equal(match({ symbol: "ASSET206", name: "unrelated" }), verified[206]);
  }
  assert.equal(reads, 414, "listing folds stay proportional to listings, not listings times tokens");
});
