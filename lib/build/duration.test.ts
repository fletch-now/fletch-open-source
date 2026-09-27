import assert from "node:assert/strict";
import { test } from "node:test";
import { durationRange, elapsedBuildMinutes, estimateBuildDuration } from "./duration";

test("duration estimate needs enough actual positive finite measurements", function coverage() {
  assert.equal(estimateBuildDuration([60_000, 120_000, 180_000, 240_000, 0, -1, NaN, Infinity]), null);
  const estimate = estimateBuildDuration([60_000, 120_000, 180_000, 240_000, 300_000]);
  assert.equal(estimate?.sampleSize, 5);
});

test("duration range rounds outward and long builds remain evidence", function percentiles() {
  const now = new Date("2026-09-13T12:00:00Z");
  const estimate = estimateBuildDuration([2.5, 5.25, 6.75, 8.5, 10, 15, 25, 38.2, 330, 390].map(minutes => minutes * 60_000), now)!;
  assert.equal(estimate.lowerMinutes, 5);
  assert.equal(estimate.upperMinutes, 330);
  assert.equal(estimate.observedAt, now.toISOString());
  assert.equal(durationRange(estimate), "5–330 min");
});

test("equal short durations show a single minute instead of zero or a fabricated range", function short() {
  const estimate = estimateBuildDuration([1000, 1200, 1500, 1700, 1900])!;
  assert.equal(durationRange(estimate), "1 min");
});

test("elapsed uses the persisted start, excludes queued time, and survives hours or refreshes", function elapsed() {
  assert.equal(elapsedBuildMinutes(null, Date.now()), null);
  assert.equal(elapsedBuildMinutes("invalid", Date.now()), null);
  assert.equal(elapsedBuildMinutes("2026-09-13T12:00:00Z", Date.parse("2026-09-13T17:30:00Z")), 330);
  assert.equal(elapsedBuildMinutes("2026-09-13T12:00:00Z", Date.parse("2026-09-13T11:59:00Z")), 0);
});
