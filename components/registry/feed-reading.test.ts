import assert from "node:assert/strict";
import { test } from "node:test";
import { feedReadingText } from "./format";

test("a missing feed link does not claim a failed fetch or invent an observation age", function missing(): void {
  assert.equal(feedReadingText(undefined), "No feed linked");
  assert.equal(feedReadingText({ feedAddress: null, feedPrice: null, feedCheckedAt: null }), "No feed linked");
  assert.equal(feedReadingText({ feedAddress: "0xfeed", feedPrice: null, feedCheckedAt: null }), "Feed not read");
});

test("known feeds distinguish unavailable answers and show only the saved check age", function checked(t): void {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-15T00:30:00Z") });
  const state = { feedAddress: "0xfeed", feedPrice: null, feedCheckedAt: new Date("2026-09-15T00:28:00Z") };
  assert.equal(feedReadingText(state), "Feed unavailable · 2 min ago");
  assert.equal(feedReadingText({ ...state, feedPrice: "12.25" }), "Feed checked · 2 min ago");
});
