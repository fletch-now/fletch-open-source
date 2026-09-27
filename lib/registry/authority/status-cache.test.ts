import assert from "node:assert/strict";
import { test } from "node:test";
import { db, pool } from "@/lib/db";
import { readScoutingCoverage } from "../scouting";
import { readSwapIndexer } from "./market-swap-status";

test("scouting shares concurrent public aggregates without freshening their measurement time", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-09-14T00:00:00Z") });
  let calls = 0;
  const read = async () => { calls++; return { rows: [{}] }; };
  t.mock.method(pool, "query", read);
  const [first, concurrent] = await Promise.all([readScoutingCoverage(777871), readScoutingCoverage(777871)]);
  assert.equal(calls, 2, "one coverage aggregate and one explorer aggregate");
  assert.equal(first, concurrent);
  t.mock.timers.tick(29_000);
  assert.equal((await readScoutingCoverage(777871)).measuredAt, first.measuredAt);
  assert.equal(calls, 2);
  t.mock.timers.tick(1001);
  assert.notEqual((await readScoutingCoverage(777871)).measuredAt, first.measuredAt);
  assert.equal(calls, 4);
  const transaction = { query: read } as unknown as Pick<typeof pool, "query">;
  await readScoutingCoverage(777871, transaction);
  await readScoutingCoverage(777871, transaction);
  assert.equal(calls, 8, "transaction snapshots never enter the public cache");
});

test("cached swap catalog keeps source time but rechecks the live-tail expiry", async (t) => {
  const now = Date.parse("2026-09-14T01:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  t.mock.method(pool, "query", async () => ({ rows: [{ value: JSON.stringify({ version: 1, measuredAt: new Date(now).toISOString(),
    scouting: { measuredAt: new Date(now).toISOString() }, swapIndexer: { checkedAt: new Date(now).toISOString(), tiers: [], historicalUsdAvailable: true } }) }] }));
  let calls = 0;
  t.mock.method(db, "execute", async () => {
    calls++;
    return { rows: [{ through_block: "100", through_at: new Date(now - 119_000), window_start_at: new Date(now - 86_400_000),
      head_block: "110", head_read_at: new Date(now), tier: "active", total: 1, enrolled: 1, complete: 1,
      historically_valued: 1, priority_pool_count: 1, priority_complete: 1, priority_valued: 1 }] };
  });
  const first = await readSwapIndexer(777872);
  assert.equal(first.current, true);
  t.mock.timers.tick(2000);
  const expired = await readSwapIndexer(777872);
  assert.equal(calls, 1);
  assert.equal(expired.checkedAt, first.checkedAt);
  assert.equal(expired.current, false, "a reused snapshot cannot extend the 120-second freshness limit");
  assert.equal(expired.historicalUsdAvailable, false);
  assert.equal(expired.lagSeconds, 121);
  t.mock.timers.tick(8001);
  assert.notEqual((await readSwapIndexer(777872)).checkedAt, first.checkedAt);
  assert.equal(calls, 2);
  await readSwapIndexer(777872, new Date());
  assert.equal(calls, 3, "an explicit observation-time read bypasses the shared cache");
});
