import assert from "node:assert/strict";
import { test } from "node:test";
import { activityGroups, activityImportance, mergeActivity, parseActivityEvent, type LiveRegistryEvent } from "./live-activity";

function event(id: string, kind = "dex.pool_new", symbol = "GLXY", seconds = 0): LiveRegistryEvent {
  return { id, kind, symbol, title: `${symbol} observation`, address: null, observedAt: new Date(Date.UTC(2026, 8, 13, 12, 0, seconds)).toISOString(), detail: {} };
}

test("activity auto filter keeps listings and alerts above routine bursts without calling recoveries alerts", function () {
  const rows = [...Array.from({ length: 14 }, (_, i) => event(`pool${i}`)), event("listing", "listing.changed", "FRONG"), event("pause", "token.paused", "TSLA"), event("resume", "token.unpaused", "TSLA")];
  const auto = activityGroups(rows, "auto", "");
  assert.deepEqual(auto.map((group) => group.importance), ["alert", "listing", "change"]);
  const pools = activityGroups(rows, "pool", "glxy");
  assert.equal(pools.length, 1);
  assert.equal(pools[0].members.length, 14);
  assert.equal(activityGroups(rows, "listing", "FRONG").length, 1);
  assert.equal(activityGroups(rows, "all", "missing").length, 0);
  assert.equal(activityImportance("registry.unblocked"), "change");
});

test("reconnect replay deduplicates and caps activity while preserving listing signals under pool spam", function () {
  const listing = event("listing", "listing.observed", "PONS");
  const rows = Array.from({ length: 800 }, (_, i) => event(`pool${i}`, "dex.pool_new", "GLXY", i + 1));
  const merged = mergeActivity([listing, rows[0]], [...rows, listing]);
  assert.ok(merged.length <= 500);
  assert.equal(merged.filter((row) => row.id === "listing").length, 1);
  assert.equal(new Set(merged.map((row) => row.id)).size, merged.length);
  assert.equal(activityGroups([event("recent"), event("old", "dex.pool_new", "GLXY", -1801)], "all", "").length, 2);
});

test("activity rejects corrupt timestamps and missing titles instead of displaying invented observations", function () {
  assert.equal(parseActivityEvent({ ...event("ok"), observedAt: "broken" }), null);
  assert.equal(parseActivityEvent({ id: "incomplete" }), null);
  assert.deepEqual(parseActivityEvent(event("ok")), event("ok"));
});
