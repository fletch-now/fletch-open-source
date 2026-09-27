import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SwapIndexerReading } from "@/lib/registry/authority/market-swap-status";
import { indexedAgeText, indexedBlockText, indexedTimeText, swapCoverageNote, swapWindowText } from "./swap-indexer-format";
import { SwapIndexerPanel } from "./swap-indexer-reading";

function reading(overrides: Partial<SwapIndexerReading> = {}): SwapIndexerReading {
  return {
    mode: "live_and_backwards", checkedAt: "2026-09-09T00:01:00Z",
    newestCountedBlock: "9007199254740993", newestCountedAt: "2026-09-09T00:00:00Z",
    headBlock: "9007199254740998", headReadAt: "2026-09-09T00:00:50Z",
    lagBlocks: "5", lagSeconds: 60, current: true,
    windowStartAt: "2026-09-08T00:00:00Z", windowEndAt: "2026-09-09T00:00:00Z",
    historicalUsdAvailable: false,
    tiers: [
      { tier: "active", totalPools: 100, enrolledPools: 70, complete24hPools: 40 },
      { tier: "quiet", totalPools: 20, enrolledPools: 5, complete24hPools: 0 },
      { tier: "dormant", totalPools: 0, enrolledPools: 0, complete24hPools: 0 },
    ], ...overrides,
  };
}

test("index numbers preserve measured zero and block precision without inventing unknown values", function numbers() {
  assert.equal(indexedBlockText("9007199254740993"), "9,007,199,254,740,993");
  assert.equal(indexedBlockText("0"), "0");
  for (const value of [null, "", "NaN", "-1", "1.2", "1e6"]) assert.equal(indexedBlockText(value), "—");
  assert.equal(indexedAgeText(0), "0 s");
  assert.equal(indexedAgeText(59.9), "59 s");
  assert.equal(indexedAgeText(3661), "1 h 1 min");
  for (const value of [null, -1, Infinity, NaN]) assert.equal(indexedAgeText(value), "—");
});

test("index dates describe UTC boundaries and reject unknown or reversed windows", function dates() {
  assert.equal(indexedTimeText("2026-09-09T01:30:00+03:00"), "2026-09-08 22:30:00 UTC");
  assert.equal(indexedTimeText(null), "—");
  assert.equal(indexedTimeText("invalid"), "—");
  assert.equal(swapWindowText("2026-09-08T23:00:00Z", "2026-09-09T23:00:00Z"), "2026-09-08 23:00:00 UTC to 2026-09-09 23:00:00 UTC");
  assert.equal(swapWindowText(null, "2026-09-09T00:00:00Z"), "—");
  assert.equal(swapWindowText("2026-09-09T00:00:00Z", "2026-09-08T00:00:00Z"), "—");
  assert.equal(swapWindowText("invalid", "2026-09-09T00:00:00Z"), "—");
});

test("a current tail does not imply enrolled pools or complete coverage", function coverage() {
  assert.equal(swapCoverageNote(reading()), "40 of 120 pools have a complete 24-hour window.");
  assert.equal(swapCoverageNote(reading({ current: false })), "The counted window is not current; figures remain unavailable.");
  assert.equal(swapCoverageNote(reading({ newestCountedAt: null, current: false })), "No counted swap window yet.");
  assert.equal(swapCoverageNote(reading({ newestCountedAt: "invalid" })), "No counted swap window yet.");
  assert.equal(swapCoverageNote(reading({ priorityPoolCount: 10, priorityComplete24hPools: 6, priorityValued24hPools: 4 })),
    "6 of 10 selected priority pools have a complete 24-hour window; 4 have supported quote valuations.");
  const unknown = reading({ newestCountedBlock: null, newestCountedAt: null, windowStartAt: null, windowEndAt: null, current: false });
  assert.doesNotMatch(swapCoverageNote(unknown), /0 swaps|complete 24-hour/);
});

test("both server surfaces render recorded times, catalog scope and quote requirements without clock drift", function panel(t) {
  const value = reading();
  const html = renderToStaticMarkup(<SwapIndexerPanel reading={value} chainId={4663} />);
  t.mock.method(Date, "now", () => Date.parse("2030-01-01T00:00:00Z"));
  assert.equal(renderToStaticMarkup(<SwapIndexerPanel reading={value} chainId={4663} />), html);
  assert.match(html, /9,007,199,254,740,993/);
  assert.match(html, /40 of 120 pools/);
  assert.match(html, /5 blocks behind the recorded head/);
  assert.match(html, /Indexed block age: 1 min 0 s/);
  assert.match(html, /2026-09-09 00:01:00 UTC/);
  assert.match(html, /Requested rolling window/);
  assert.match(html, /Volume requires a supported historical quote method/);
  assert.match(html, /href="\/registry\/status"/);
  const status = renderToStaticMarkup(<SwapIndexerPanel reading={value} chainId={4663} showStatusLink={false} />);
  assert.doesNotMatch(status, /href="\/registry\/status"/);
  assert.match(status, /href="\/api\/v1\/chains\/4663\/status"/);
});
