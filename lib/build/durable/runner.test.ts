import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";

test("actual worker runner preserves accepted builds across web startup, Docker Stop and worker loss", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL || process.env.FLETCH_TEST_DOCKER !== "1",
}, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `worker_runner_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.MOONSHOT_API_KEY = "controlled-unused-provider-key";
  process.env.FORGE_AGENT_SANDBOX = "docker";
  process.env.FORGE_AGENT_IMAGE = "alpine:3";
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-actual-worker-")));
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const { db, pool, close } = await import("@/lib/db");
  const { runBuildWorkerOnce, reconcileLostBuildWorkers } = await import("./runner");
  const { enrollWorkerBuild } = await import("./ownership");
  const { workerEvents, workerOperation } = await import("./execution");
  const { STOP_REQUESTED } = await import("@/lib/build/cancellation");
  const { runTool } = await import("@/lib/build/foundry");
  const { requestBuildStop, recoverInterruptedBuilds } = await import("@/lib/build/queue");
  const { reapStaleBuilds } = await import("@/lib/build/reaper");
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  t.after(async function cleanup() {
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  async function enroll(id: string): Promise<void> {
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid')", [id]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values($1,'fixture-owner',$1,'Fixture','platform','platform','kimi-k3')", [id]);
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
    await enrollWorkerBuild(pool, id);
  }
  async function waitForContainer(id: string): Promise<string> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const row = (await pool.query("select sandbox_id from builds where id=$1", [id])).rows[0];
      const source = await readFile(join(root, "workspaces", id, "Saved.sol"), "utf8").catch(function missing() { return ""; });
      if (row?.sandbox_id && source) return row.sandbox_id;
      await delay(50);
    }
    throw new Error("The controlled worker never started its sandbox.");
  }

  await t.test("web startup retains an independently executing Docker tool and Stop refunds once after cleanup", async function stop() {
    await enroll("worker-stop");
    const running = runBuildWorkerOnce("actual-worker", { heartbeatMs: 50, leaseMs: 2000, builder() {
      return { async *run(input) {
        yield { phase: "planning", text: "Controlled tool started" };
        await workerOperation("fixture-tool", "tool", () => runTool(join(root, "workspaces", input.slug), ["sh", "-c", "printf 'saved source' > Saved.sol; sleep 60"]));
        yield { phase: "done", text: "Controlled tool finished" };
      } };
    } });
    const container = await waitForContainer("worker-stop");
    assert.deepEqual(await recoverInterruptedBuilds(db), []);
    assert.equal(await reapStaleBuilds(-1, db), 0);
    const restartedWeb = spawnSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
      await import('./workers/server-runtime.ts');
      const { failOrphanedBuilds } = await import('./instrumentation-node.ts');
      await failOrphanedBuilds();
      await (await import('./lib/db/index.ts')).close();
    `], { env: process.env, encoding: "utf8" });
    assert.equal(restartedWeb.status, 0, restartedWeb.stderr);
    assert.equal((await pool.query("select status from builds where id='worker-stop'")).rows[0].status, "building");
    assert.equal(await requestBuildStop("worker-stop", "other-owner", db), false);
    assert.equal(await requestBuildStop("worker-stop", "fixture-owner", db), true);
    assert.equal(await running, "stopped");
    assert.notEqual(spawnSync("docker", ["inspect", container]).status, 0);
    assert.equal(await readFile(join(root, "workspaces", "worker-stop", "Saved.sol"), "utf8"), "saved source");
    assert.equal((await pool.query("select count(*)::int as n from credit_events where reason='refund' and build_id='worker-stop'")).rows[0].n, 1);
    await reconcileLostBuildWorkers();
    assert.equal((await pool.query("select count(*)::int as n from credit_events where reason='refund' and build_id='worker-stop'")).rows[0].n, 1);
  });

  await t.test("successful settlement atomically writes one terminal transcript and preserves the accepted debit", async function success() {
    await enroll("worker-success");
    const outcome = await runBuildWorkerOnce("actual-worker", { builder(options) {
      return { async *run(input) {
        await workerOperation("fixture-tool", "tool", () => runTool(join(root, "workspaces", input.slug), ["sh", "-c", "printf 'saved source' > Saved.sol"]));
        options?.onCost?.({ inputTokens: 10, outputTokens: 5, usd: 0.01, model: "fixture" });
        yield { phase: "done", text: "Controlled success", previewUrl: "https://new.fixture.invalid" };
      } };
    } });
    assert.equal(outcome, "completed");
    const row = (await pool.query("select status,tokens_in,cost_usd from builds where id='worker-success'")).rows[0];
    assert.equal(row.status, "succeeded");
    assert.equal(row.tokens_in, 10);
    assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id='worker-success'")).rows[0].credits, -1);
    assert.equal((await pool.query("select preview_url from projects where id='worker-success'")).rows[0].preview_url, "https://new.fixture.invalid");
    assert.equal((await pool.query("select count(*)::int as n from build_logs where build_id='worker-success' and level='done'")).rows[0].n, 1);
  });

  await t.test("an accepted retry restores its earlier full brief before planning and keeps saved source", async function retryBrief() {
    const { analyseNeeds } = await import("@/lib/agent/needs-analysis");
    await enroll("brief-retry");
    const prompt = "Read brief/pasted-brief.txt in full and use it as the build brief.";
    const specification = "Build a factory and ERC-20 bonding curve with signed buy, sell, funding and fee withdrawal flows. COMPLETE-BRIEF-TAIL";
    await pool.query("update builds set prompt=$2 where id=$1", ["brief-retry", prompt]);
    await pool.query(`insert into builds(id,user_id,project_id,prompt,attachments,status,created_at,started_at,finished_at)
      values('brief-original','fixture-owner','brief-retry',$1,$2,'failed',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '5 minutes',clock_timestamp()-interval '4 minutes')`,
    [prompt, JSON.stringify([{ name: "pasted-brief.txt", content: specification }])]);
    const workspace = join(root, "workspaces", "brief-retry");
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "Saved.sol"), "contract Saved {}\n");
    let requests = 0;
    const outcome = await runBuildWorkerOnce("actual-worker", { builder(options) {
      return { async *run(input) {
        assert.deepEqual(input.restoredBriefs, ["pasted-brief.txt"]);
        assert.equal((input.attachments![0] as { content: string }).content, specification);
        const needs = await analyseNeeds(options!.provider!, input, false, async function received(_provider, messages) {
          requests++;
          assert.ok(messages[1].content.includes(specification));
          return { text: '{"contract":true,"wallet":true,"reason":"The restored brief requires a factory and signed trading."}', usage: { inputTokens: 40, outputTokens: 20 }, finishReason: "stop" };
        });
        options!.onNeeds!(needs.verdict, false);
        assert.equal(await readFile(join(workspace, "Saved.sol"), "utf8"), "contract Saved {}\n");
        yield { phase: "done", text: "Controlled planner recovery fixture finished." };
      } };
    } });
    assert.equal(outcome, "completed");
    assert.equal(requests, 1);
    const row = (await pool.query("select needs_contract,needs_wallet,attachments from builds where id='brief-retry'")).rows[0];
    assert.equal(row.needs_contract, true);
    assert.equal(row.needs_wallet, true);
    assert.equal(row.attachments, null, "immutable accepted input is preserved; recovery enriches execution context");
    assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id='brief-retry'")).rows[0].credits, -1);
  });

  await t.test("known closed model errors drain their receipt and refund without blocking the project", async function modelFailure() {
    await enroll("known-error");
    const outcome = await runBuildWorkerOnce("actual-worker", { builder() {
      return { async *run() {
        yield* workerEvents("controlled-cli", "model", async function* ended() {
          yield { phase: "error" as const, text: "The controlled model process exited with an error." };
        });
      } };
    } });
    assert.equal(outcome, "completed");
    assert.equal((await pool.query("select status from builds where id='known-error'")).rows[0].status, "failed");
    assert.equal((await pool.query("select state from build_worker_effects where build_id='known-error'")).rows[0].state, "completed");
    assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id='known-error'")).rows[0].credits, 0);
  });

  await t.test("a planner connection failure settles once after cleanup and preserves its specific error", async function planningFailure() {
    const { analyseNeeds } = await import("@/lib/agent/needs-analysis");
    await enroll("planner-failure");
    let requests = 0;
    const outcome = await runBuildWorkerOnce("actual-worker", { builder(options) {
      assert.ok(options?.provider);
      return { async *run() {
        await analyseNeeds(options.provider!, { prompt: "A factory with wallet actions" }, false, async function disconnected() {
          requests += 1;
          throw new Error("Controlled planner connection failure");
        });
        yield { phase: "done", text: "Must not continue after an unresolved planner request" };
      } };
    } });
    assert.equal(outcome, "completed");
    assert.equal(requests, 1);
    const row = (await pool.query("select status,error,tokens_in,tokens_out,cost_usd from builds where id='planner-failure'")).rows[0];
    assert.equal(row.status, "failed");
    assert.match(row.error, /^Planning could not get a complete response/);
    assert.equal(row.tokens_in, null);
    assert.equal(row.tokens_out, null);
    assert.equal(row.cost_usd, null);
    const effects = (await pool.query("select state,receipt from build_worker_effects where build_id='planner-failure'")).rows;
    assert.equal(effects.length, 1);
    assert.equal(effects[0].state, "completed");
    assert.equal(effects[0].receipt.outcome, "failed_after_cleanup");
    assert.equal(effects[0].receipt.usage, "unknown");
    await reconcileLostBuildWorkers();
    assert.equal((await pool.query("select count(*)::int as n from credit_events where reason='refund' and build_id='planner-failure'")).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int as n from build_logs where level='error' and build_id='planner-failure'")).rows[0].n, 1);
  });

  await t.test("Stop after intent but before dispatch records no external call and reaches stopped", async function beforeDispatch() {
    await enroll("before-dispatch");
    await pool.query(`create function fixture_stop_before_dispatch() returns trigger language plpgsql as $$ begin
      if new.kind='effect_intent' and new.build_id='before-dispatch' then
        update builds set error='${STOP_REQUESTED.replaceAll("'", "''")}' where id=new.build_id;
      end if; return new; end $$`);
    await pool.query("create trigger fixture_stop before insert on build_worker_events for each row execute function fixture_stop_before_dispatch()");
    let dispatched = false;
    try {
      assert.equal(await runBuildWorkerOnce("actual-worker", { builder() {
        return { async *run() {
          await workerOperation("controlled-publication", "publication", async function never() { dispatched = true; return {}; });
          yield { phase: "done", text: "Must not publish" };
        } };
      } }), "stopped");
      assert.equal(dispatched, false);
      assert.equal((await pool.query("select receipt->>'outcome' as outcome from build_worker_effects where build_id='before-dispatch'")).rows[0].outcome, "not_dispatched");
    } finally {
      await pool.query("drop trigger fixture_stop on build_worker_events");
      await pool.query("drop function fixture_stop_before_dispatch()");
    }
  });

  await t.test("missing accepted provider fails before dispatch without occupying a recovery slot", async function setup() {
    await enroll("missing-provider");
    const key = process.env.MOONSHOT_API_KEY;
    delete process.env.MOONSHOT_API_KEY;
    try {
      assert.equal(await runBuildWorkerOnce("actual-worker"), "completed");
      assert.equal((await pool.query("select status from builds where id='missing-provider'")).rows[0].status, "failed");
      assert.equal((await pool.query("select count(*)::int as n from build_worker_effects where build_id='missing-provider'")).rows[0].n, 0);
      assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id='missing-provider'")).rows[0].credits, 0);
    } finally {
      process.env.MOONSHOT_API_KEY = key;
    }
  });

  await t.test("SIGKILL of the actual runner leaves source, pauses rather than replaying, and accepts Stop while recovering", async function crash() {
    await enroll("worker-crash");
    const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "--input-type=module", "-e", `
      import { join } from 'node:path';
      await import('./workers/server-runtime.ts');
      const { runBuildWorkerOnce } = await import('./lib/build/durable/runner.ts');
      import { workerOperation } from './lib/build/durable/execution.ts';
      const { runTool } = await import('./lib/build/foundry.ts');
      await runBuildWorkerOnce('crashed-worker',{ builder() { return { async *run(input) {
        await workerOperation('fixture-tool','tool',()=>runTool(join(process.env.FORGE_WORKSPACE_ROOT,input.slug),['sh','-c',"printf 'saved source' > Saved.sol; sleep 60"]));
        yield {phase:'done',text:'Should never finish'};
      } }; } });
    `], { env: process.env, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", function error(chunk) { stderr += String(chunk); });
    t.after(function kill() { child.kill("SIGKILL"); });
    const container = await waitForContainer("worker-crash").catch(function failed(cause) { throw new Error(`${String(cause)} ${stderr}`); });
    const exited = once(child, "exit"); child.kill("SIGKILL"); await exited;
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id='worker-crash'");
    assert.equal(await reconcileLostBuildWorkers(), 1);
    assert.notEqual(spawnSync("docker", ["inspect", container]).status, 0);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id='worker-crash'")).rows[0].state, "recovery_required");
    assert.equal(await runBuildWorkerOnce("successor", { builder() { throw new Error("Must not replay paid work"); } }), "idle");
    await requestBuildStop("worker-crash", "fixture-owner", db);
    await reconcileLostBuildWorkers();
    assert.equal((await pool.query("select state from build_worker_jobs where build_id='worker-crash'")).rows[0].state, "stopped");
    assert.equal(await readFile(join(root, "workspaces", "worker-crash", "Saved.sol"), "utf8"), "saved source");
    assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id='worker-crash'")).rows[0].credits, 0);
  });
});
