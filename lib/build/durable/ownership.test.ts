import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { test } from "node:test";
import { Pool } from "pg";
import { STOP_REQUESTED } from "@/lib/build/cancellation";
import {
  beginWorkerEffect, claimWorkerBuild, completeWorkerEffect, enrollWorkerBuild,
  finishWorkerBuild, heartbeatWorker, readWorkerEvents, recordWorkerCheckpoint,
  recoverExpiredWorkers, reconcileWorkerBuild, requestWorkerStop, WorkerFenceError, type WorkerClaim,
} from "./ownership";
import { runWorkerOnce } from "./worker";
import { createWorkerScheduler } from "./scheduler";

const HASH = "a".repeat(64);

test("durable worker lifecycle uses isolated PostgreSQL locks, receipts and recovery", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function durable(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const namespace = `durable_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const options = `-c search_path=${namespace},public`;
  const pool = new Pool({ connectionString, max: 12, options });
  t.after(async function cleanup() {
    await pool.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
  });
  // This fixture cannot access application rows. The additive migration runs
  // unchanged against the small existing-build contract it actually requires.
  await pool.query("create table builds(id text primary key,project_id text,user_id text,status text,error text,started_at timestamptz,trigger_run_id text)");
  await pool.query("create table credit_events(id text primary key,delta integer)");
  await pool.query("create table app_settings(key text primary key,value text)");
  await pool.query("insert into credit_events values('accepted-one-credit',-1)");
  const migration = await readFile("drizzle/0054_build_worker.sql", "utf8");
  await pool.query(migration);
  await pool.query(migration);
  // Apply the exact additive worker constraints from the pricing migration;
  // this fixture intentionally has no billing tables or application enum types.
  const pricingMigration = await readFile("drizzle/0057_build_pricing.sql", "utf8");
  const workerDelta = pricingMigration.slice(pricingMigration.indexOf("ALTER TABLE build_worker_jobs"), pricingMigration.indexOf("CREATE TABLE IF NOT EXISTS build_pricing_quotes"));
  assert.ok(workerDelta.includes("paused_budget"));
  await pool.query(workerDelta);

  await t.test("Drizzle declarations match the additive migration, including checks and partial indexes", async function schemaParity() {
    const exported = spawnSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect=postgresql", "--schema=./lib/db/build-worker-schema.ts"], { encoding: "utf8" });
    assert.equal(exported.status, 0, exported.stderr);
    const otherNamespace = `${namespace}_schema`;
    await admin.query(`create schema ${otherNamespace}`);
    const other = new Pool({ connectionString, options: `-c search_path=${otherNamespace},public` });
    async function definition(database: Pool, name: string): Promise<unknown> {
      const columns = await database.query(`
        select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
        where table_schema=$1 and table_name like 'build_worker_%' order by table_name,ordinal_position
      `, [name]);
      const constraints = await database.query(`
        select conname,pg_get_constraintdef(oid) as definition from pg_constraint where connamespace=$1::regnamespace
          and conrelid::regclass::text like 'build_worker_%' order by conname
      `, [name]);
      const indexes = await database.query("select indexname,indexdef from pg_indexes where schemaname=$1 and tablename like 'build_worker_%' order by indexname", [name]);
      return { columns: columns.rows, constraints: constraints.rows, indexes: indexes.rows.map(function normalize(row) {
        return { ...row, indexdef: row.indexdef.replaceAll(`${name}.`, "") };
      }) };
    }
    try {
      await other.query("create table builds(id text primary key)");
      await other.query(exported.stdout.replaceAll('"public".', `"${otherNamespace}".`));
      assert.deepEqual(await definition(other, otherNamespace), await definition(pool, namespace));
    } finally {
      await other.end();
      await admin.query(`drop schema ${otherNamespace} cascade`);
    }
  });

  async function reset(): Promise<void> {
    await pool.query("truncate build_worker_events,build_worker_effects,build_worker_jobs,builds");
  }
  async function enroll(id: string, project = id): Promise<void> {
    await pool.query("insert into builds(id,project_id,user_id,status,error) values($1,$2,'owner','queued',null)", [id, project]);
    assert.equal(await enrollWorkerBuild(pool, id), true);
  }
  async function claim(id = "worker-1", leaseMs = 30_000): Promise<WorkerClaim> {
    const value = await claimWorkerBuild(pool, id, leaseMs);
    assert.ok(value);
    return value;
  }
  async function expire(buildId: string): Promise<void> {
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [buildId]);
  }

  await t.test("scheduler fills actual accepted workers and stops at the first unclaimable job", async function scheduled() {
    await reset();
    await enroll("scheduler-a"); await enroll("scheduler-b"); await enroll("scheduler-c");
    let attempts = 0;
    const finish: Array<() => void> = [];
    const scheduler = createWorkerScheduler(function run(onClaim) {
      attempts++;
      return runWorkerOnce(pool, `scheduler-${attempts}`, {
        async run(context) {
          await context.checkpoint(HASH);
          await new Promise<void>(function pending(resolve) { finish.push(resolve); });
        },
        async cleanup() {},
      }, { onClaim });
    }, function unexpected(cause) { throw cause; });
    await scheduler.fill(50);
    assert.equal(attempts, 3);
    assert.equal(scheduler.active, 2);
    assert.equal(Number((await pool.query("select count(*) from build_worker_jobs where state='running'")).rows[0].count), 2);
    // Wait for both bounded adapters to reach their held execution point.
    while (finish.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
    for (const done of finish) done();
    await scheduler.settled();
    assert.equal(scheduler.active, 0);
    await reset();
  });

  await t.test("contending workers hold one project owner, bounded capacity and durable event cursors", async function contention() {
    await enroll("a", "shared");
    await enroll("b", "shared");
    await enroll("c", "different");
    const attempts = await Promise.all(Array.from({ length: 30 }, function start(_, index) { return claimWorkerBuild(pool, `worker-${index}`); }));
    const claims = attempts.filter(function present(value) { return value !== null; });
    assert.deepEqual(claims.map(function id(value) { return value.buildId; }).sort(), ["a", "c"]);
    const first = claims.find(function first(value) { return value.buildId === "a"; })!;
    await Promise.all(Array.from({ length: 20 }, function checkpoint() { return recordWorkerCheckpoint(pool, first, HASH); }));
    const page = await readWorkerEvents(pool, "a", 0, 10);
    const next = await readWorkerEvents(pool, "a", page.at(-1)!.seq);
    assert.deepEqual([...page, ...next].map(function seq(row) { return row.seq; }), Array.from({ length: 21 }, function seq(_, index) { return index + 1; }));
    await finishWorkerBuild(pool, first);
    await pool.query("update builds set status='succeeded' where id=$1", [first.buildId]);
    assert.equal((await claim()).buildId, "b");
  });

  await t.test("expired ownership cannot renew, append, dispatch or finalize; project stays reserved", async function expired() {
    await reset();
    await enroll("a", "shared");
    await enroll("b", "shared");
    const owned = await claim();
    await recordWorkerCheckpoint(pool, owned, HASH);
    await beginWorkerEffect(pool, owned, "model:initial", "model");
    await expire("a");
    await assert.rejects(heartbeatWorker(pool, owned), WorkerFenceError);
    assert.deepEqual(await recoverExpiredWorkers(pool), ["a"]);
    assert.deepEqual(await recoverExpiredWorkers(pool), []);
    await assert.rejects(recordWorkerCheckpoint(pool, owned, HASH), WorkerFenceError);
    await assert.rejects(beginWorkerEffect(pool, owned, "model:retry", "model"), WorkerFenceError);
    await assert.rejects(completeWorkerEffect(pool, owned, "model:initial", { tokens: 100 }), WorkerFenceError);
    await assert.rejects(finishWorkerBuild(pool, owned), WorkerFenceError);
    assert.equal(await claimWorkerBuild(pool, "successor"), null);
    assert.equal(await requestWorkerStop(pool, "a", "owner"), true);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id='a'")).rows[0].state, "recovery_required");
  });

  await t.test("lease expiring while a write waits on a row lock fences that write", async function lockWait() {
    await reset();
    await enroll("locked");
    const owned = await claim("worker-1", 200);
    const blocker = await pool.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select 1 from build_worker_jobs where build_id='locked' for update");
      const rejected = assert.rejects(recordWorkerCheckpoint(pool, owned, HASH), WorkerFenceError);
      await new Promise(function wait(resolve) { setTimeout(resolve, 250); });
      await blocker.query("commit");
      await rejected;
      assert.equal((await readWorkerEvents(pool, "locked")).length, 1);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });

  await t.test("dispatch intent survives process loss without model replay, publication replay or credit changes", async function killed() {
    await reset();
    await enroll("crash", "shared");
    await enroll("next", "shared");
    const script = `
      import { Pool } from 'pg';
      import { createRequire } from 'node:module';
      const { runWorkerOnce } = createRequire(import.meta.url)('./lib/build/durable/worker.ts');
      const pool = new Pool({connectionString:process.env.FLETCH_TEST_DATABASE_URL,options:process.env.FLETCH_FIXTURE_PG_OPTIONS});
      await runWorkerOnce(pool,'child-worker',{
        async run(context) {
          await context.checkpoint('${HASH}');
          await context.effect('publish:release','publication',async function dispatch() {
            process.stdout.write('DISPATCHED\\n');
            await new Promise(function pending() {});
            return {};
          });
        },
        async cleanup() {}
      });
    `;
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
      env: { ...process.env, FLETCH_FIXTURE_PG_OPTIONS: options }, stdio: ["ignore", "pipe", "pipe"],
    });
    t.after(function killFixture() { child.kill("SIGKILL"); });
    await new Promise<void>(function dispatched(resolve, reject) {
      const timeout = setTimeout(function timedOut() { reject(new Error("Crash fixture never dispatched.")); }, 10_000);
      child.stdout.on("data", function output(chunk) {
        if (String(chunk).includes("DISPATCHED")) { clearTimeout(timeout); resolve(); }
      });
      child.once("exit", function exited(code) { clearTimeout(timeout); reject(new Error(`Fixture exited early: ${code}`)); });
      child.stderr.on("data", function error(chunk) { clearTimeout(timeout); reject(new Error(String(chunk))); });
    });
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    await expire("crash");
    assert.deepEqual(await recoverExpiredWorkers(pool), ["crash"]);
    assert.equal(await claimWorkerBuild(pool, "restarted-worker"), null);
    assert.deepEqual((await pool.query("select effect_key,state from build_worker_effects")).rows, [{ effect_key: "publish:release", state: "uncertain" }]);
    assert.deepEqual((await pool.query("select * from credit_events")).rows, [{ id: "accepted-one-credit", delta: -1 }]);
  });

  await t.test("effect key cannot repeat and its completed receipt cannot be overwritten", async function effectOnce() {
    await reset();
    await enroll("effect");
    const owned = await claim();
    await assert.rejects(beginWorkerEffect(pool, owned, "model:first", "model"), /checkpoint/);
    await recordWorkerCheckpoint(pool, owned, HASH);
    await beginWorkerEffect(pool, owned, "model:first", "model");
    await assert.rejects(beginWorkerEffect(pool, owned, "model:first", "model"), /reconcile/);
    await assert.rejects(finishWorkerBuild(pool, owned), /Uncertain/);
    await completeWorkerEffect(pool, owned, "model:first", { requestId: "fixture-request", usage: 42 });
    await assert.rejects(completeWorkerEffect(pool, owned, "model:first", { usage: 0 }), /already/);
    await assert.rejects(beginWorkerEffect(pool, owned, "model:first", "model"), /reconcile/);
    await finishWorkerBuild(pool, owned);
  });

  await t.test("saved boundary resumes with a new fence and returns completed receipts without dispatching twice", async function resume() {
    await reset();
    await enroll("resume");
    const prior = await claim();
    await recordWorkerCheckpoint(pool, prior, HASH);
    await beginWorkerEffect(pool, prior, "tool:compile", "tool");
    await completeWorkerEffect(pool, prior, "tool:compile", { compiled: true });
    await recordWorkerCheckpoint(pool, prior, HASH);
    await expire("resume");
    await recoverExpiredWorkers(pool);
    assert.equal(await reconcileWorkerBuild(pool, prior, async function verify(hash) {
      return { verifiedCheckpointHash: hash, cleanupReceipt: "fixture-prior-process-exited" };
    }), "queued");
    let repeatedDispatches = 0;
    let observedAttempt = 0;
    assert.equal(await runWorkerOnce(pool, "restarted-worker", {
      async run(context) {
        observedAttempt = context.claim.attempt;
        assert.equal(context.claim.checkpointHash, HASH);
        await assert.rejects(recordWorkerCheckpoint(pool, prior, HASH), WorkerFenceError);
        const receipt = await context.effect("tool:compile", "tool", async function never() { repeatedDispatches += 1; return {}; });
        assert.deepEqual(receipt, { compiled: true });
      },
      async cleanup() {},
    }), "completed");
    assert.equal(observedAttempt, 2);
    assert.equal(repeatedDispatches, 0);
    const events = await readWorkerEvents(pool, "resume");
    assert.deepEqual(events.map(function seq(row) { return row.seq; }), events.map(function seq(_, index) { return index + 1; }));
  });

  await t.test("recovery refuses mismatched source and receipts newer than the saved source boundary", async function incompleteCheckpoint() {
    await reset();
    await enroll("resume");
    const prior = await claim();
    await recordWorkerCheckpoint(pool, prior, HASH);
    await beginWorkerEffect(pool, prior, "model:first", "model");
    await completeWorkerEffect(pool, prior, "model:first", { usage: 42 });
    await expire("resume");
    await recoverExpiredWorkers(pool);
    await assert.rejects(reconcileWorkerBuild(pool, prior, async function mismatch() {
      return { verifiedCheckpointHash: "b".repeat(64), cleanupReceipt: "fixture-exited" };
    }), /verified source/);
    await assert.rejects(reconcileWorkerBuild(pool, prior, async function verify(hash) {
      return { verifiedCheckpointHash: hash, cleanupReceipt: "fixture-exited" };
    }), /checkpoint after/);
    assert.equal(await claimWorkerBuild(pool, "successor"), null);
  });

  await t.test("Stop arriving during recovery verification prevents another attempt", async function stopRecovering() {
    await reset();
    await enroll("recovery-stop");
    const prior = await claim();
    await recordWorkerCheckpoint(pool, prior, HASH);
    await expire("recovery-stop");
    await recoverExpiredWorkers(pool);
    const outcome = await reconcileWorkerBuild(pool, prior, async function verify(hash) {
      await requestWorkerStop(pool, "recovery-stop", "owner");
      return { verifiedCheckpointHash: hash, cleanupReceipt: "fixture-exited" };
    });
    assert.equal(outcome, "stopped");
    assert.equal(await claimWorkerBuild(pool, "successor"), null);
  });

  await t.test("Stop is owned and crosses processes through the existing persisted marker", async function stop() {
    await reset();
    await enroll("stop");
    const owned = await claim();
    assert.equal(await requestWorkerStop(pool, "stop", "different-owner"), false);
    await recordWorkerCheckpoint(pool, owned, HASH);
    await beginWorkerEffect(pool, owned, "model:first", "model");
    await pool.query("update builds set error=$1 where id='stop'", [STOP_REQUESTED]);
    await assert.rejects(beginWorkerEffect(pool, owned, "model:late", "model"), WorkerFenceError);
    assert.deepEqual(await heartbeatWorker(pool, owned), { stopRequested: true });
    await completeWorkerEffect(pool, owned, "model:first", { usage: "unknown", providerRequestId: "retained" });
    await assert.rejects(finishWorkerBuild(pool, owned), WorkerFenceError);
    await finishWorkerBuild(pool, owned, true);
  });

  await t.test("adapter renews ownership, handles Stop during a silent wait and confirms cleanup", async function adapterStop() {
    await reset();
    await enroll("silent");
    let cleanup = false;
    let observedAbort = false;
    const outcome = await runWorkerOnce(pool, "adapter-worker", {
      async run(context) {
        await context.checkpoint(HASH);
        await requestWorkerStop(pool, "silent", "owner");
        await new Promise<void>(function wait(resolve) {
          context.signal.addEventListener("abort", function stopped() { observedAbort = true; resolve(); }, { once: true });
        });
      },
      async cleanup() { cleanup = true; },
    }, { heartbeatMs: 20, leaseMs: 1000 });
    assert.equal(outcome, "stopped");
    assert.ok(cleanup && observedAbort);
  });

  await t.test("quiet bounded execution survives its initial lease through actual heartbeats", async function renew() {
    await reset();
    await enroll("renew");
    const outcome = await runWorkerOnce(pool, "adapter-worker", {
      async run(context) {
        await context.checkpoint(HASH);
        await new Promise(function wait(resolve) { setTimeout(resolve, 650); });
        context.signal.throwIfAborted();
      },
      async cleanup() {},
    }, { heartbeatMs: 30, leaseMs: 200 });
    assert.equal(outcome, "completed");
    const result = await pool.query<{ renewed: boolean }>("select heartbeat_at > created_at+interval '500 milliseconds' as renewed from build_worker_jobs");
    assert.equal(result.rows[0].renewed, true);
  });

  await t.test("failed cleanup and unknown provider response keep ownership reserved after Stop", async function uncertainStop() {
    for (const cleanupFails of [true, false]) {
      await reset();
      await enroll("unknown");
      const outcome = await runWorkerOnce(pool, "adapter-worker", {
        async run(context) {
          await context.checkpoint(HASH);
          await requestWorkerStop(pool, "unknown", "owner");
          if (!cleanupFails) {
            // The provider may have charged; missing response is never zero.
            await pool.query("insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash) values('unknown','model:inflight',1,'model',$1)", [HASH]);
          }
        },
        async cleanup() { if (cleanupFails) throw new Error("Sandbox removal unconfirmed."); },
      });
      assert.equal(outcome, "recovery_required");
      assert.equal((await pool.query("select state from build_worker_jobs")).rows[0].state, "recovery_required");
    }
  });

  await t.test("new process can read committed progress without affecting live ownership", async function restartWeb() {
    await reset();
    await enroll("live");
    const owned = await claim();
    await recordWorkerCheckpoint(pool, owned, HASH);
    const newWebPool = new Pool({ connectionString, options });
    try {
      assert.equal((await readWorkerEvents(newWebPool, "live")).length, 2);
      assert.deepEqual(await recoverExpiredWorkers(newWebPool), []);
      assert.deepEqual(await heartbeatWorker(pool, owned), { stopRequested: false });
    } finally {
      await newWebPool.end();
    }
  });
});
