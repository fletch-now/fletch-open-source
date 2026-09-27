import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { JOB_CADENCES, type JobName } from "./cadence";
import { createRegistryJobScheduler, type RegistryJob } from "./job-scheduler";

function barrier(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>(function pending(resolve) { release = resolve; });
  return { wait, release };
}

test("state gets one priority admission, older work follows, and Stop discards queued work", async function priority(t): Promise<void> {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const scheduler = createRegistryJobScheduler(2, function unexpected(_job, cause) { assert.fail(String(cause)); });
  t.after(scheduler.stop);
  const started: JobName[] = [];
  const finish = new Map<JobName, ReturnType<typeof barrier>>();
  for (const name of ["priority-universe", "lookalikes", "dex-state", "explorer-scouting"] as const) {
    const done = barrier();
    finish.set(name, done);
    scheduler.schedule({ name, everyMs: JOB_CADENCES[name], async run() {
      started.push(name);
      await done.wait;
      return { rows: 1 };
    } }, 0);
  }
  t.mock.timers.tick(0);
  assert.deepEqual(started, ["priority-universe"]);
  assert.deepEqual(scheduler.queued, ["lookalikes", "dex-state", "explorer-scouting"]);
  finish.get("priority-universe")!.release();
  await setImmediate();
  assert.deepEqual(started, ["priority-universe", "dex-state"]);
  finish.get("dex-state")!.release();
  await setImmediate();
  assert.deepEqual(started, ["priority-universe", "dex-state", "lookalikes"]);
  scheduler.stop();
  finish.get("lookalikes")!.release();
  await setImmediate();
  t.mock.timers.tick(120_000);
  assert.deepEqual(started, ["priority-universe", "dex-state", "lookalikes"]);
  assert.deepEqual(scheduler.running, []);
  assert.deepEqual(scheduler.queued, []);
  assert.throws(function undersized() { createRegistryJobScheduler(1, function ignore() {}); }, /at least two/);
});

test("actual scheduled runs retain start cadence and failed-run backoff without overlap", async function cadence(t): Promise<void> {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const scheduler = createRegistryJobScheduler(4, function unexpected(_job, cause) { assert.fail(String(cause)); });
  t.after(scheduler.stop);
  const first = barrier();
  const starts: number[] = [];
  const job: RegistryJob = { name: "dex-state", everyMs: JOB_CADENCES["dex-state"], async run() {
    starts.push(Date.now());
    if (starts.length === 1) await first.wait;
    if (starts.length === 2) return null;
    return { rows: 1 };
  } };
  scheduler.schedule(job, 0);
  t.mock.timers.tick(0);
  scheduler.schedule(job, 0);
  t.mock.timers.tick(33_000);
  assert.deepEqual(starts, [0], "A second schedule cannot overlap an accepted run");
  first.release();
  await setImmediate();
  t.mock.timers.tick(11_999);
  assert.deepEqual(starts, [0]);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.deepEqual(starts, [0, 45_000]);
  // Failed state refreshes retain their existing cadence-based retry delay.
  t.mock.timers.tick(44_999);
  assert.equal(starts.length, 2);
  t.mock.timers.tick(1);
  await setImmediate();
  assert.deepEqual(starts, [0, 45_000, 90_000]);
});

test("five lock-owning jobs complete nested queries through the real four-connection pool", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
  timeout: 10_000,
}, async function contention(t): Promise<void> {
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 200 });
  t.after(async function close() { await database.end(); });
  const held = await Promise.all(Array.from({ length: 4 }, function connect() { return database.connect(); }));
  try {
    await assert.rejects(database.query("select 1"), /timeout exceeded when trying to connect/, "The ungated overlap reproduces the production checkout timeout");
  } finally {
    for (const client of held) client.release();
  }

  const errors: unknown[] = [];
  const scheduler = createRegistryJobScheduler(database.options.max!, function failed(_job, cause) { errors.push(cause); });
  t.after(scheduler.stop);
  const names: JobName[] = ["priority-universe", "explorer-scouting", "priority-holders", "lookalikes", "dex-state"];
  const allDone = barrier();
  const firstWave = barrier();
  let holders = 0;
  let peak = 0;
  let completed = 0;
  let heartbeat = false;
  for (const [index, name] of names.entries()) {
    scheduler.schedule({ name, everyMs: JOB_CADENCES[name], async run() {
      const owner = await database.connect();
      holders++;
      peak = Math.max(peak, holders);
      try {
        await owner.query("select pg_advisory_lock($1,$2)", [919283, index]);
        if (holders === 3) firstWave.release();
        await firstWave.wait;
        assert.equal((await database.query("select 1 as accounted")).rows[0].accounted, 1);
        return { rows: 1 };
      } finally {
        await owner.query("select pg_advisory_unlock($1,$2)", [919283, index]);
        owner.release();
        holders--;
        completed++;
        if (completed === names.length) allDone.release();
      }
    } }, 0);
  }
  scheduler.schedule({ name: "chain-health", everyMs: JOB_CADENCES["chain-health"], async run() {
    await database.query("select 1");
    heartbeat = true;
    return { rows: 1 };
  } }, 0);
  await allDone.wait;
  await setImmediate();
  assert.deepEqual(errors, []);
  assert.equal(peak, 3);
  assert.equal(completed, 5);
  assert.equal(heartbeat, true, "Lightweight work continues while the lock-owning jobs contend");
  assert.deepEqual(scheduler.running, []);
  assert.equal(database.waitingCount, 0);
});
