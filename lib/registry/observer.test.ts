import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { Freshness } from "@/lib/registry/authority/freshness";

function reading(at: number, verdict: "fresh" | "late" | "stalled" = "late"): Freshness {
  const observed = new Date(at);
  const sourceTime = new Date("2026-01-01T00:00:00Z");
  return {
    swapIndexer: { mode: "live_and_backwards", checkedAt: new Date(0).toISOString(), newestCountedBlock: null, newestCountedAt: null, headBlock: null, headReadAt: null, lagBlocks: null, lagSeconds: null, windowStartAt: null, windowEndAt: null, current: false, tiers: [], historicalUsdAvailable: false },
    chainId: 4663, checkedAt: observed, verdict: verdict === "fresh" ? "live" : "degraded", summary: "Fixture",
    daemon: { name: "registry-daemon", lastBeatAt: sourceTime, ageMs: 100, alive: true, jobsReported: 1, failing: [] },
    head: { block: BigInt(100), readAt: sourceTime, ageMs: 100 },
    jobs: [{ job: "control-plane", cadenceMs: 20000, lastRunAt: sourceTime, lastOkAt: sourceTime, ageMs: 100, rows: 1, error: null, running: false, verdict, checkpoints: [{ name: "control-plane:4663", block: BigInt(90), head: BigInt(100), behind: BigInt(10), updatedAt: sourceTime, blocksPerHour: null, hoursLeft: null }] }],
    figures: [],
  };
}

test("registry observer records transitions atomically without altering source observations", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function observer(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { auditLog, daemonHeartbeats, syncCheckpoints } = await import("@/lib/db/schema");
  const { observeRegistry, recordRegistryObservation } = await import("@/lib/registry/observer");
  const name = `registry-observer-test-${randomUUID()}`;
  const start = Date.now();
  const sourceBeats = await db.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, "registry-daemon"));
  const checkpointName = `${name}:source-checkpoint`;
  async function audits(): Promise<Array<typeof auditLog.$inferSelect>> {
    return db.select().from(auditLog).where(eq(auditLog.actorId, name));
  }
  async function beat(): Promise<typeof daemonHeartbeats.$inferSelect | undefined> {
    const [row] = await db.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, name));
    return row;
  }
  try {
    const checkpoints = await db.insert(syncCheckpoints).values({
      name: checkpointName, chainId: 777359, blockNumber: BigInt(90),
      blockHash: `0x${"a".repeat(64)}`, updatedAt: new Date("2026-01-01T00:00:00Z"),
    }).returning();
    await t.test("first reading records a transition and retains source times", async function initial() {
      assert.deepEqual(await recordRegistryObservation(reading(start), name), { changed: true, recorded: true, verdict: "degraded" });
      assert.equal((await audits()).length, 1);
      const row = await beat();
      const detail = row?.detail as { checkedAt: string; daemonLastBeatAt: string; jobs: Array<{ checkpoints: Array<{ block: string; updatedAt: string }> }> };
      assert.equal(detail.checkedAt, new Date(start).toISOString());
      assert.equal(detail.daemonLastBeatAt, "2026-01-01T00:00:00.000Z");
      assert.deepEqual(detail.jobs[0].checkpoints[0], { name: "control-plane:4663", block: "90", updatedAt: "2026-01-01T00:00:00.000Z" });
    });
    await t.test("DB-backed dedup ignores age and timestamp changes across calls", async function unchanged() {
      const next = reading(start + 1000);
      next.jobs[0].ageMs = 999;
      next.jobs[0].lastRunAt = new Date(start);
      assert.equal((await recordRegistryObservation(next, name)).changed, false);
      assert.equal((await audits()).length, 1);
      const detail = (await beat())?.detail as { checkedAt: string };
      assert.equal(detail.checkedAt, next.checkedAt.toISOString());
    });
    await t.test("concurrent same transition emits one audit and rejects older readings", async function concurrent() {
      const results = await Promise.all(Array.from({ length: 6 }, () => recordRegistryObservation(reading(start + 2000, "stalled"), name)));
      assert.equal(results.filter(result => result.changed).length, 1);
      assert.equal((await audits()).length, 2);
      assert.equal((await recordRegistryObservation(reading(start + 500), name)).recorded, false);
      assert.equal((await audits()).length, 2);
    });
    await t.test("recovery is recorded even after an unchanged degraded overall verdict", async function recovery() {
      assert.equal((await recordRegistryObservation(reading(start + 3000, "fresh"), name)).changed, true);
      assert.equal((await audits()).length, 3);
    });
    await t.test("figure verdict changes are recorded while job verdicts stay unchanged", async function figureChange() {
      const next = reading(start + 3500, "fresh");
      next.figures = [{ figure: "fixture-price", what: "Fixture price", job: "control-plane", cadenceMs: 20000, newestAt: new Date("2026-01-01"), ageMs: 1000, count: 1, unit: "prices", verdict: "late" }];
      assert.equal((await recordRegistryObservation(next, name)).changed, true);
      assert.equal((await audits()).length, 4);
    });
    await t.test("read and DB write failures leave both heartbeat and audit unchanged", async function failures() {
      const before = await beat();
      await assert.rejects(observeRegistry(4663, async function unavailable() { throw new Error("private database detail"); }, name));
      const invalid = reading(start + 4000, "late");
      invalid.head!.block = BigInt(2) ** BigInt(64);
      await assert.rejects(recordRegistryObservation(invalid, name));
      assert.deepEqual(await beat(), before);
      assert.equal((await audits()).length, 4);
    });
    assert.deepEqual(await db.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, "registry-daemon")), sourceBeats);
    assert.deepEqual(await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.name, checkpointName)), checkpoints);
  } finally {
    await db.delete(syncCheckpoints).where(eq(syncCheckpoints.name, checkpointName));
    await db.delete(auditLog).where(eq(auditLog.actorId, name));
    await db.delete(daemonHeartbeats).where(eq(daemonHeartbeats.name, name));
    await close();
  }
});
