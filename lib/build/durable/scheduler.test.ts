import assert from "node:assert/strict";
import { test } from "node:test";
import { createWorkerScheduler } from "./scheduler";
import type { WorkerOutcome } from "./worker";

test("an empty queue makes one attempt per poll even with 50 free slots", async function idle() {
  let attempts = 0;
  const scheduler = createWorkerScheduler(async function run() { attempts++; return "idle"; }, function unexpected(cause) { throw cause; });
  await scheduler.fill(50); await scheduler.settled();
  assert.equal(attempts, 1); assert.equal(scheduler.active, 0);
  await scheduler.fill(50); await scheduler.settled();
  assert.equal(attempts, 2);
});

test("claims fill sequentially while accepted jobs run concurrently and a lowered ceiling waits", async function fill() {
  const finish: Array<(outcome: WorkerOutcome) => void> = [];
  let attempts = 0;
  const scheduler = createWorkerScheduler(async function run(claimed) {
    attempts++;
    if (attempts > 3) return "idle";
    claimed();
    return new Promise<WorkerOutcome>(function pending(resolve) { finish.push(resolve); });
  }, function unexpected(cause) { throw cause; });
  await Promise.all([scheduler.fill(50), scheduler.fill(50)]);
  assert.equal(attempts, 4); assert.equal(scheduler.active, 3);
  await scheduler.fill(1); assert.equal(attempts, 4);
  finish[0]("completed"); finish[1]("paused_budget"); finish[2]("stopped");
  await scheduler.settled(); assert.equal(scheduler.active, 0);
  await scheduler.fill(50); await scheduler.settled(); assert.equal(attempts, 5);
});

test("a failed claim is observed once and does not fan out more work", async function failed() {
  const failures: unknown[] = [];
  let attempts = 0;
  const scheduler = createWorkerScheduler(async function run() { attempts++; throw new Error("database unavailable"); }, function report(cause) { failures.push(cause); });
  await scheduler.fill(50); await scheduler.settled();
  assert.equal(attempts, 1); assert.equal(failures.length, 1); assert.equal(scheduler.active, 0);
});

test("100 active jobs share one fill operation and capacity reductions preserve them", async function hundred() {
  const finish: Array<(outcome: WorkerOutcome) => void> = [];
  let attempts = 0;
  const scheduler = createWorkerScheduler(async function run(claimed) {
    attempts++;
    claimed();
    return new Promise<WorkerOutcome>(function pending(resolve) { finish.push(resolve); });
  }, function unexpected(cause) { throw cause; });
  await Promise.all([scheduler.fill(100), scheduler.fill(100)]);
  assert.equal(attempts, 100);
  assert.equal(scheduler.active, 100);
  await scheduler.fill(20);
  assert.equal(scheduler.active, 100);
  for (const capacity of [0, 101, NaN]) await assert.rejects(scheduler.fill(capacity));
  assert.equal(attempts, 100);
  for (const complete of finish) complete("completed");
  await scheduler.settled();
  assert.equal(scheduler.active, 0);
});


test("release drain preserves accepted jobs and refuses every later claim", async function drain() {
  let calls = 0;
  let finish!: (outcome: WorkerOutcome) => void;
  const scheduler = createWorkerScheduler(async function run(claimed) {
    calls++;
    claimed();
    return new Promise<WorkerOutcome>((resolve) => { finish = resolve; });
  }, function unexpected(cause) { throw cause; });
  await scheduler.fill(1);
  scheduler.drain();
  await scheduler.fill(100);
  assert.equal(calls, 1);
  assert.equal(scheduler.active, 1);
  finish("completed");
  await scheduler.settled();
  await scheduler.fill(100);
  assert.equal(calls, 1);
  assert.equal(scheduler.active, 0);
});
