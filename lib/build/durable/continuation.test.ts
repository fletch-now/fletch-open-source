import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { beginWorkerEffect, claimWorkerBuild, completeWorkerEffect, enrollWorkerBuild, recoverExpiredWorkers, workerTransaction } from "./ownership";
import { saveAgentContinuation, pauseAgentBudget, validateBudgetContinuation, restoreAgentContinuation, queueCleanAgentContinuation } from "./continuation";
import { workerEvents, workerOperation, withWorkerExecution, type BuildExecution } from "./execution";
import { BuildBudgetPause, guardWorkerAllowance } from "./budget";
import { continueOwnedBuild } from "./continue";
import { runWorkerOnce } from "./worker";
import { buildSignal } from "../cancellation";
import { recordBuildActiveSeconds } from "../pricing-budget";

const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
test("clean continuation preserves ownership, consent and cumulative time across more than five hours", { skip: !connectionString }, async function suite(t) {
  const admin = new Pool({ connectionString });
  const schema = `continuation_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-continuation-test-")));
  const archiveRoot = join(root, "checkpoints");
  const previousArchiveRoot = process.env.FORGE_CHECKPOINT_ROOT;
  const previousWorkspaceRoot = process.env.FORGE_WORKSPACE_ROOT;
  process.env.FORGE_WORKSPACE_ROOT = root;
  process.env.FORGE_CHECKPOINT_ROOT = archiveRoot;
  t.after(async function cleanup() {
    if (previousArchiveRoot === undefined) delete process.env.FORGE_CHECKPOINT_ROOT;
    else process.env.FORGE_CHECKPOINT_ROOT = previousArchiveRoot;
    if (previousWorkspaceRoot === undefined) delete process.env.FORGE_WORKSPACE_ROOT;
    else process.env.FORGE_WORKSPACE_ROOT = previousWorkspaceRoot;
    await pool.end(); await admin.query(`drop schema ${schema} cascade`); await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  await pool.query(`create type build_status as enum ('queued','building'); create type credit_reason as enum ('build_debit');
    create table "user"(id text primary key); insert into "user" values('owner');
    create table projects(id text primary key,slug text);
    create table builds(id text primary key,project_id text,user_id text,status text,error text,started_at timestamptz,trigger_run_id text,sandbox_id text,billing_mode text);
    create table credit_events(id text primary key,user_id text,delta integer,reason text,build_id text,idempotency_key text unique);
    create table app_settings(key text primary key,value jsonb);`);
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  const migrations = (await import("node:fs/promises")).readdir;
  const pricingMigration = (await migrations("drizzle")).find(name => name.startsWith("0057"))!;
  await pool.query(await readFile(join("drizzle", pricingMigration), "utf8"));
  let counter = 0;
  async function fixture(activeSeconds = 21600): Promise<BuildExecution> {
    const id = `build-${++counter}`;
    await pool.query("insert into builds(id,project_id,user_id,status,billing_mode,pricing_snapshot) values($1,$1,'owner','queued','platform',$2)", [id, { approvalWindowSeconds: 3600 }]);
    await pool.query("insert into build_pricing_quotes(id,user_id,build_id,fingerprint,digest,snapshot,expires_at) values($1,'owner',$1,'fixture','fixture','{}',clock_timestamp()+interval '1 hour')", [id]);
    await pool.query("insert into build_budget_authorizations(id,user_id,build_id,quote_id,packages,incremental_credits,cumulative_credits,allowance,client_request_id) values($1,'owner',$1,$1,1,1,1,$2,$1)", [id,
      { modelRequests: 100, toolRuns: 20, activeSeconds, maxAgentStepsPerTurn: 2 }]);
    await enrollWorkerBuild(pool, id);
    const claim = await claimWorkerBuild(pool, `owner-${id}`);
    assert.equal(claim?.buildId, id);
    const workspace = join(root, id);
    await mkdir(join(workspace, ".agent-home/.kimi-code"), { recursive: true });
    await writeFile(join(workspace, "source.sol"), "retained source");
    const sessionId = `session_${randomUUID()}`;
    const execution: BuildExecution = { pool, claim: claim!, workspace, archiveRoot, signal: new AbortController().signal,
      nextOperation: 0, activeKey: null, containers: new Set(), continuationContext: { phase: "initial_agent", summary: "retained instructions" },
      cleanSession: { sessionId, files: { ".agent-home/.kimi-code/session_index.jsonl": JSON.stringify({ sessionId }) } } };
    return execution;
  }
  async function completeFixture(execution: BuildExecution): Promise<void> {
    await pool.query("update builds set status='failed' where id=$1", [execution.claim.buildId]);
    await pool.query("update build_worker_jobs set state='completed' where build_id=$1", [execution.claim.buildId]);
  }

  await t.test("owner Continue resumes only a verified clean checkpoint without a second charge", async () => {
    const execution = await fixture();
    await saveAgentContinuation(execution);
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [execution.claim.buildId]);
    await recoverExpiredWorkers(pool);
    assert.equal((await continueOwnedBuild(pool, execution.claim.buildId, "other-owner")).status, 404);
    const credits = (await pool.query("select count(*)::integer as n from credit_events")).rows[0].n;
    assert.equal((await continueOwnedBuild(pool, execution.claim.buildId, "owner")).status, 202);
    assert.equal((await continueOwnedBuild(pool, execution.claim.buildId, "owner")).queued, true);
    assert.equal((await pool.query("select count(*)::integer as n from credit_events")).rows[0].n, credits);
    await completeFixture(execution);
    const unsafe = await fixture();
    await saveAgentContinuation(unsafe);
    await beginWorkerEffect(pool, unsafe.claim, "after-clean-boundary", "model");
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [unsafe.claim.buildId]);
    await recoverExpiredWorkers(pool);
    assert.equal((await continueOwnedBuild(pool, unsafe.claim.buildId, "owner")).status, 409);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id=$1", [unsafe.claim.buildId])).rows[0].state, "recovery_required");
    await completeFixture(unsafe);
  });

  await t.test("renewed clean segments accumulate six hours without a single six-hour request or duplicate time receipt", async () => {
    const execution = await fixture();
    let segments = 0;
    await withWorkerExecution(execution, async () => {
      for (let index = 0; index < 12; index++) {
        for await (const value of workerEvents("agent-turn", "model", async function* segment() {
          await guardWorkerAllowance(execution, `segment-${index}`, "model_request");
          segments += 1; yield index;
        })) assert.equal(value, index);
        // Simulated independent 30-minute active observations, never one unbounded call.
        await workerTransaction(pool, client => recordBuildActiveSeconds(client, execution.claim.buildId, `elapsed-${index}`, 1800));
        await workerTransaction(pool, client => recordBuildActiveSeconds(client, execution.claim.buildId, `elapsed-${index}`, 1800));
        if (index < 11) await saveAgentContinuation(execution);
      }
      await saveAgentContinuation(execution);
      await assert.rejects(workerOperation("forbidden", "tool", async () => { throw new Error("dispatched beyond budget"); }), BuildBudgetPause);
    });
    assert.equal(segments, 12);
    const usage = await pool.query("select sum(units)::integer as seconds from build_budget_usage where build_id=$1 and kind='active_time'", [execution.claim.buildId]);
    assert.ok(usage.rows[0].seconds >= 21600);
    await pauseAgentBudget(execution, "active_time");
    assert.equal((await pool.query("select status from builds where id=$1", [execution.claim.buildId])).rows[0].status, "paused");
    const client = await pool.connect();
    try { await validateBudgetContinuation(client, execution.claim.buildId); } finally { client.release(); }
    await completeFixture(execution);
  });

  await t.test("paused work releases physical capacity but retains its project and immutable session", async () => {
    const execution = await fixture(); await saveAgentContinuation(execution); await pauseAgentBudget(execution, "model_requests");
    await pool.query("insert into builds(id,project_id,user_id,status) values('same-project',$1,'owner','queued')", [execution.claim.buildId]);
    await enrollWorkerBuild(pool, "same-project");
    assert.equal(await claimWorkerBuild(pool, "other-owner"), null);
    // This explicit transition stands for the separately tested accepted extension transaction.
    await pool.query("update build_worker_jobs set state='queued',owner_id=null,fence=null,lease_expires_at=null where build_id=$1", [execution.claim.buildId]);
    await pool.query("update builds set status='queued' where id=$1", [execution.claim.buildId]);
    const next = await claimWorkerBuild(pool, "replacement"); assert.equal(next?.buildId, execution.claim.buildId);
    const restored = { ...execution, claim: next! };
    assert.deepEqual(await restoreAgentContinuation(restored), execution.continuationContext);
    assert.equal(await readFile(join(execution.workspace, "source.sol"), "utf8"), "retained source");
    assert.ok((await readFile(join(execution.workspace, ".agent-home/.kimi-code/session_index.jsonl"), "utf8")).includes(execution.cleanSession!.sessionId));
    await completeFixture(restored);
    await pool.query("update builds set status='failed' where id='same-project'");
    await pool.query("update build_worker_jobs set state='completed' where build_id='same-project'");
  });

  await t.test("crash at an exact clean checkpoint queues once; any later intent blocks replay", async () => {
    const execution = await fixture(); await saveAgentContinuation(execution);
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [execution.claim.buildId]);
    await recoverExpiredWorkers(pool);
    assert.equal(await queueCleanAgentContinuation(execution, execution.claim.buildId), true);
    assert.equal(await queueCleanAgentContinuation(execution, execution.claim.buildId), false);
    const next = await claimWorkerBuild(pool, "crash-replacement"); assert.ok(next);
    const resumed = { ...execution, claim: next };
    await restoreAgentContinuation(resumed);
    await beginWorkerEffect(pool, next, "unknown-paid", "model");
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [next.buildId]);
    await recoverExpiredWorkers(pool);
    await assert.rejects(queueCleanAgentContinuation(resumed, next.buildId), /requires reconciliation/);
    await completeFixture(resumed);
  });

  await t.test("even a known response after the saved session cannot be replayed from that older checkpoint", async () => {
    const execution = await fixture(); await saveAgentContinuation(execution);
    await beginWorkerEffect(pool, execution.claim, "response-not-in-session", "model");
    await completeWorkerEffect(pool, execution.claim, "response-not-in-session", { outcome: "response_received" });
    await assert.rejects(pauseAgentBudget(execution, "allowance"), /requires reconciliation/);
    await completeFixture(execution);
  });

  await t.test("daemon shutdown retains a clean checkpoint instead of treating it as user cancellation", async () => {
    const execution = await fixture();
    await pool.query("update builds set status='queued' where id=$1", [execution.claim.buildId]);
    await pool.query("update build_worker_jobs set state='queued',owner_id=null,fence=null,lease_expires_at=null where build_id=$1", [execution.claim.buildId]);
    const shutdown = new AbortController();
    let failureSettlements = 0;
    const outcome = await runWorkerOnce(pool, "graceful-owner", {
      async run(context) {
        execution.claim = context.claim; execution.signal = context.signal;
        await saveAgentContinuation(execution);
        shutdown.abort(new Error("Owned fixture daemon shutdown"));
        context.signal.throwIfAborted();
      },
      async cleanup() {},
      async failAfterCleanup() { failureSettlements++; return true; },
    }, { signal: shutdown.signal });
    assert.equal(outcome, "recovery_required");
    assert.equal(failureSettlements, 0);
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [execution.claim.buildId]);
    assert.equal(await queueCleanAgentContinuation(execution, execution.claim.buildId), true);
    await completeFixture(execution);
  });

  await t.test("a current operation is aborted at its remaining allowance, before the normal tool deadline", async () => {
    const execution = await fixture(1);
    const started = performance.now();
    let aborted = false;
    await assert.rejects(withWorkerExecution(execution, () => workerOperation("bounded-tool", "tool", async () => {
      const signal = buildSignal(); assert.ok(signal);
      await new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => { aborted = true; reject(signal.reason); }, { once: true });
      });
    })), /timeout|timed out/i);
    assert.equal(aborted, true);
    assert.ok(performance.now() - started < 3000, "the allowance must not allow the normal multi-minute tool timeout");
    assert.equal((await pool.query("select state from build_worker_effects where build_id=$1", [execution.claim.buildId])).rows[0].state, "uncertain");
    await assert.rejects(saveAgentContinuation(execution), /current effect has a receipt/);
    await completeFixture(execution);
  });

  await t.test("source changes and Stop both refuse clean restart", async () => {
    const execution = await fixture(); await saveAgentContinuation(execution);
    await writeFile(join(execution.workspace, "source.sol"), "newer source must not be overwritten");
    await assert.rejects(pauseAgentBudget(execution, "allowance"), /source changed|exceeds its byte limit/);
    await pool.query("update build_worker_jobs set stop_requested_at=clock_timestamp(),lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [execution.claim.buildId]);
    await recoverExpiredWorkers(pool);
    assert.equal(await queueCleanAgentContinuation(execution, execution.claim.buildId), false);
    await completeFixture(execution);
  });
});
