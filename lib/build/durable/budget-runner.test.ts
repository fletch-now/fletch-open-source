import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";

test("actual runner pauses a clean accepted budget, then Stop releases its exact reserve once", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async t => {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `budget_runner_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.MOONSHOT_API_KEY = "unused-owned-local-fixture";
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-budget-runner-")));
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const { pool, close } = await import("@/lib/db");
  const { runBuildWorkerOnce, reconcileLostBuildWorkers } = await import("./runner");
  const { enrollWorkerBuild } = await import("./ownership");
  const { currentWorkerExecution, workerEvents } = await import("./execution");
  const { saveAgentContinuation } = await import("./continuation");
  const { BuildBudgetPause } = await import("./budget");
  const { requestBuildStop } = await import("../queue");
  t.after(async () => { await close(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); await rm(root, { recursive: true, force: true }); });
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings", "build_pricing_quotes", "build_budget_authorizations", "build_budget_usage", "build_pricing_settlements"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await pool.query("alter table build_worker_jobs drop constraint build_worker_jobs_state_check; alter table build_worker_jobs add constraint build_worker_jobs_state_check check(state in ('queued','running','recovery_required','paused_budget','completed','stopped'))");
  const id = "owned-budget-pause";
  await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid')", [id]);
  await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model,pricing_snapshot) values($1,'fixture-owner',$1,'Fixture','platform','platform','kimi-k3',$2)", [id, { approvalWindowSeconds: 3600 }]);
  await pool.query("insert into build_pricing_quotes(id,user_id,build_id,fingerprint,digest,snapshot,expires_at) values($1,'fixture-owner',$1,'fixture','fixture','{}',clock_timestamp()+interval '1 hour')", [id]);
  await pool.query("insert into build_budget_authorizations(id,user_id,build_id,quote_id,packages,incremental_credits,cumulative_credits,allowance,client_request_id) values($1,'fixture-owner',$1,$1,1,3,3,$2,$1)", [id, { modelRequests: 10, toolRuns: 10, activeSeconds: 3600, maxAgentStepsPerTurn: 1 }]);
  await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-3,'build_reserve',$2)", [id, `reserve:${id}`]);
  await enrollWorkerBuild(pool, id);
  let segments = 0;
  assert.equal(await runBuildWorkerOnce("owned-worker", { builder() { return { async *run() {
    const execution = currentWorkerExecution()!;
    execution.continuationContext = { phase: "initial_agent", instructions: "same original owned task" };
    for await (const event of workerEvents("agent-turn", "model", async function* segment() {
      segments++;
      await mkdir(join(execution.workspace, ".agent-home/.kimi-code"), { recursive: true });
      await writeFile(join(execution.workspace, "retained.sol"), "retained owned source");
      execution.cleanSession = { sessionId: `session_${randomUUID()}`, files: { ".agent-home/.kimi-code/session_index.jsonl": "owned fixture" } };
      yield { phase: "scaffolding" as const, text: "Saved source" };
    })) yield event;
    await saveAgentContinuation(execution);
    throw new BuildBudgetPause("model_requests");
  } }; } }), "paused_budget");
  assert.equal(segments, 1);
  const paused = (await pool.query("select b.status,j.state,b.sandbox_id from builds b join build_worker_jobs j on j.build_id=b.id where b.id=$1", [id])).rows[0];
  assert.deepEqual(paused, { status: "paused", state: "paused_budget", sandbox_id: null });
  assert.equal((await pool.query("select count(*)::integer as n from build_pricing_settlements where build_id=$1", [id])).rows[0].n, 0);
  assert.equal(await requestBuildStop(id, "fixture-owner"), true);
  await reconcileLostBuildWorkers(); await reconcileLostBuildWorkers();
  const settled = (await pool.query("select status,error from builds where id=$1", [id])).rows[0];
  assert.equal(settled.status, "failed"); assert.match(settled.error, /Stopped by you/);
  assert.equal((await pool.query("select count(*)::integer as n from credit_events where build_id=$1 and reason='build_release' and delta=3", [id])).rows[0].n, 1);
  assert.equal(await readFile(join(root, "workspaces", id, "retained.sol"), "utf8"), "retained owned source");
  assert.equal((await pool.query("select preview_url from projects where id=$1", [id])).rows[0].preview_url, "https://previous.fixture.invalid");
  assert.equal((await pool.query("select outcome from build_pricing_settlements where build_id=$1", [id])).rows[0].outcome, "stopped");
  assert.equal(segments, 1);
  await t.test("exhaustion before any clean session fails and releases credit instead of holding a slot", async () => {
    const other = "owned-no-clean-session";
    await pool.query("insert into projects(id,user_id,slug,name) values($1,'fixture-owner',$1,'Fixture')", [other]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model,pricing_snapshot) select $2,user_id,$2,prompt,billing_mode,custody_mode,model,pricing_snapshot from builds where id=$1", [id, other]);
    await pool.query("insert into build_pricing_quotes(id,user_id,build_id,fingerprint,digest,snapshot,expires_at) select $2,user_id,$2,fingerprint,digest,snapshot,expires_at from build_pricing_quotes where id=$1", [id, other]);
    await pool.query("insert into build_budget_authorizations(id,user_id,build_id,quote_id,packages,incremental_credits,cumulative_credits,allowance,client_request_id) select $2,user_id,$2,$2,packages,incremental_credits,cumulative_credits,allowance,$2 from build_budget_authorizations where id=$1", [id, other]);
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-3,'build_reserve',$2)", [other, `reserve:${other}`]);
    await enrollWorkerBuild(pool, other);
    assert.equal(await runBuildWorkerOnce("no-clean-owner", { builder() { return { async *run() {
      currentWorkerExecution()!.continuationContext = { phase: "initial_agent" };
      yield { phase: "planning", text: "Owned fixture" };
      throw new BuildBudgetPause("model_requests");
    } }; } }), "completed");
    const failed = (await pool.query("select b.status,j.state from builds b join build_worker_jobs j on j.build_id=b.id where b.id=$1", [other])).rows[0];
    assert.deepEqual(failed, { status: "failed", state: "completed" });
    assert.equal((await pool.query("select count(*)::integer as n from credit_events where build_id=$1 and reason='build_release' and delta=3", [other])).rows[0].n, 1);
  });
});
