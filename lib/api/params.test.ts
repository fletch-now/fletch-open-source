// Run with: node --import tsx --test lib/api/params.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLimit, parseOffset, parseSymbolParam } from "@/lib/api/params";

test("parseLimit: missing value is the default", function () {
  assert.equal(parseLimit(null, 100, 500), 100);
});

test("parseLimit: a value inside the range is kept", function () {
  assert.equal(parseLimit("7", 100, 500), 7);
});

test("parseLimit: text falls back to the default instead of dropping the cap", function () {
  assert.equal(parseLimit("abc", 100, 500), 100);
  assert.equal(parseLimit("", 100, 500), 100);
  assert.equal(parseLimit("NaN", 100, 500), 100);
  assert.equal(parseLimit("Infinity", 100, 500), 100);
});

test("parseLimit: fractions are truncated", function () {
  assert.equal(parseLimit("1.5", 100, 500), 1);
});

test("parseLimit: zero and negatives fall back", function () {
  assert.equal(parseLimit("0", 100, 500), 100);
  assert.equal(parseLimit("-1", 100, 500), 100);
});

test("parseLimit: anything above the ceiling is clamped", function () {
  assert.equal(parseLimit("1e9", 100, 500), 500);
  assert.equal(parseLimit("501", 100, 500), 500);
});

test("parseOffset: malformed and negative read as the first page", function () {
  assert.equal(parseOffset(null), 0);
  assert.equal(parseOffset("abc"), 0);
  assert.equal(parseOffset("-5"), 0);
  assert.equal(parseOffset("2.5"), 0);
  assert.equal(parseOffset("40"), 40);
});

test("parseSymbolParam: upper-cases a ticker and refuses anything else", function () {
  assert.equal(parseSymbolParam("aapl"), "AAPL");
  assert.equal(parseSymbolParam("BRK.B"), "BRK.B");
  assert.equal(parseSymbolParam("%zz"), null);
  assert.equal(parseSymbolParam(""), null);
  assert.equal(parseSymbolParam("A".repeat(17)), null);
  assert.equal(parseSymbolParam("../etc"), null);
});
