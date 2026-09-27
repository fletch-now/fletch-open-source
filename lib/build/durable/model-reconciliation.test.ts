import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";

test("model failure operator requires stopped ownership and a quiescent saved workspace", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL || process.env.FLETCH_TEST_DOCKER !== "1", timeout: 120_000,
}, async function reconcile(t) {
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname), "Use a local disposable database");
  const admin = new Pool({ connectionString: url.toString() });
  const namespace = `model_reconcile_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-model-reconcile-")));
  const previous = { database: process.env.DATABASE_URL, workspace: process.env.FORGE_WORKSPACE_ROOT };
  process.env.DATABASE_URL = url.toString();
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  const archiveRoot = join(root, "checkpoints");
  const containers: string[] = [];
  const { pool, close } = await import("@/lib/db");
  const { reconcileModelFailure, assertWorkspaceQuiescent } = await import("./model-reconciliation");
  const { verifySourceCheckpoint } = await import("./checkpoints");
  const { enrollWorkerBuild, claimWorkerBuild, recordWorkerCheckpoint, beginWorkerEffect, recoverExpiredWorkers } = await import("./ownership");
  const { STOP_REQUESTED } = await import("@/lib/build/cancellation");
  t.after(async function cleanup() {
    for (const name of containers) {
      try { execFileSync("docker", ["rm", "--force", name], { stdio: "ignore", timeout: 10_000 }); } catch { /* Already removed by confirmed owned cleanup. */ }
    }
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
    if (previous.database === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous.database;
    if (previous.workspace === undefined) delete process.env.FORGE_WORKSPACE_ROOT;
    else process.env.FORGE_WORKSPACE_ROOT = previous.workspace;
  });
  for (const table of ["builds", "build_logs", "credit_events", "projects", "contracts"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  async function paused(id: string, ownKey = false): Promise<string> {
    await pool.query("truncate build_worker_events,build_worker_effects,build_worker_jobs,build_logs,contracts,credit_events,builds,projects");
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'fixture-owner',$1,'Fixture','https://previous.fixture.invalid')", [id]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode) values($1,'fixture-owner',$1,'Saved fixture',$2,$3)", [id, ownKey ? "own_key" : "platform", ownKey ? "hosted" : "platform"]);
    if (!ownKey) await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'fixture-owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
    await enrollWorkerBuild(pool, id);
    const claim = await claimWorkerBuild(pool, "fixture-worker");
    assert.ok(claim);
    await recordWorkerCheckpoint(pool, claim, "a".repeat(64));
    await beginWorkerEffect(pool, claim, "model-failed", "model");
    await pool.query("update build_worker_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where build_id=$1", [id]);
    await recoverExpiredWorkers(pool);
    const workspace = join(root, "workspaces", id);
    await mkdir(workspace, { recursive: true });
    await writeFile(join(workspace, "App.sol"), "contract SavedSource {}\n");
    return workspace;
  }
  async function stillHeld(id: string): Promise<void> {
    const result = await pool.query("select j.state,b.status,e.state effect from build_worker_jobs j join builds b on b.id=j.build_id join build_worker_effects e on e.build_id=j.build_id and e.effect_key='model-failed' where j.build_id=$1", [id]);
    assert.deepEqual(result.rows[0], { state: "recovery_required", status: "building", effect: "uncertain" });
    assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 0);
  }
  async function stopped(): Promise<void> {}
  function container(workspace: string, start = false): string {
    const name = `fletch-test-${randomUUID()}`;
    execFileSync("docker", ["create", "--name", name, "--mount", `type=bind,source=${workspace},target=/workspace`, "alpine:3", "sleep", "60"], { stdio: "pipe", timeout: 15_000 });
    containers.push(name);
    if (start) execFileSync("docker", ["start", name], { stdio: "pipe", timeout: 10_000 });
    return name;
  }

  await t.test("Docker inventory refreshes only proven disappearing IDs, preserves overlap checks and bounds retries", async function inventoryRace() {
    const bin = join(root, "fake-bin");
    const config = join(root, "inventory-fixture.json");
    const state = join(root, "inventory-count.txt");
    await mkdir(bin);
    await writeFile(join(bin, "docker"), `#!${process.execPath}
const fs=require('node:fs');
const config=JSON.parse(fs.readFileSync(${JSON.stringify(config)},'utf8'));
const state=${JSON.stringify(state)};
const id='a'.repeat(64);
if(process.argv[2]==='container'){console.log(id);process.exit(0);}
const count=Number(fs.existsSync(state)?fs.readFileSync(state,'utf8'):0)+1;
fs.writeFileSync(state,String(count));
if(config.mode==='unavailable'){console.error('Cannot connect to the Docker daemon');process.exit(1);}
if(config.mode==='foreign'){console.error('error: no such object: '+'b'.repeat(64));process.exit(1);}
if(config.mode==='mixed'){console.error('error: no such object: '+id+'\\nPermission denied');process.exit(1);}
if(count===1||config.mode==='unstable'){console.error('error: no such object: '+id);process.exit(1);}
console.log(JSON.stringify(config.mode==='overlap'?[{Type:'bind',Source:config.workspace,RW:true}]:[]));
`);
    await chmod(join(bin, "docker"), 0o700);
    const previousPath = process.env.PATH;
    try {
      process.env.PATH = `${bin}:${previousPath ?? ""}`;
      for (const mode of ["clear", "overlap", "unstable", "unavailable", "foreign", "mixed"]) {
        await writeFile(config, JSON.stringify({ mode, workspace: root }));
        await rm(state, { force: true });
        if (mode === "clear") await assertWorkspaceQuiescent(root);
        else if (mode === "overlap") await assert.rejects(assertWorkspaceQuiescent(root), /writable mount overlapping/);
        else await assert.rejects(assertWorkspaceQuiescent(root));
        let expected = 1;
        if (mode === "clear" || mode === "overlap") expected = 2;
        if (mode === "unstable") expected = 3;
        assert.equal(Number(await readFile(state, "utf8")), expected, mode);
      }
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  await t.test("dry run leaves rows, container, source and checkpoint storage untouched", async function dryRun() {
    const workspace = await paused("dry-run");
    const name = container(workspace, true);
    await pool.query("update builds set sandbox_id=$2 where id=$1", ["dry-run", name]);
    const result = await reconcileModelFailure(pool, { buildId: "dry-run", archiveRoot, verifyWorkerStopped: async function forbidden() { assert.fail("Dry run must not request cleanup"); } });
    assert.equal(result.outcome, "ready");
    assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", name], { encoding: "utf8" }).trim(), "true");
    await assert.rejects(readdir(archiveRoot), { code: "ENOENT" });
    await stillHeld("dry-run");
    execFileSync("docker", ["rm", "--force", name], { stdio: "ignore" });
  });
  await t.test("a running worker proof blocks every mutation", async function activeOwner() {
    await paused("active-owner");
    await assert.rejects(reconcileModelFailure(pool, { buildId: "active-owner", archiveRoot, apply: true,
      verifyWorkerStopped: async function active() { throw new Error("Worker is active"); } }), /Worker is active/);
    await stillHeld("active-owner");
  });
  await t.test("changed owner fence is rejected before cleanup", async function staleFence() {
    await paused("stale-fence");
    await assert.rejects(reconcileModelFailure(pool, { buildId: "stale-fence", archiveRoot, apply: true,
      verifyWorkerStopped: async function changed() { await pool.query("update build_worker_jobs set fence='new-fence' where build_id='stale-fence'"); } }), /attempt changed/);
    await stillHeld("stale-fence");
  });
  await t.test("an overlapping stopped container remains owned by its original caller and blocks settlement", async function otherWriter() {
    const workspace = await paused("other-writer");
    const name = container(workspace);
    await assert.rejects(reconcileModelFailure(pool, { buildId: "other-writer", archiveRoot, apply: true, verifyWorkerStopped: stopped }), /writable mount overlapping/);
    assert.equal(execFileSync("docker", ["inspect", "--format", "{{.State.Status}}", name], { encoding: "utf8" }).trim(), "created");
    await stillHeld("other-writer");
    execFileSync("docker", ["rm", name], { stdio: "ignore" });
  });
  await t.test("uncertain non-model work and a newly appeared effect both stay held", async function uncertainOther() {
    for (const kind of ["tool", "deployment", "publication"]) {
      await paused(`unknown-${kind}`);
      await pool.query("insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash) values($1,'other',1,$2,$3)", [`unknown-${kind}`, kind, "a".repeat(64)]);
      const result = await reconcileModelFailure(pool, { buildId: `unknown-${kind}`, archiveRoot, apply: true, verifyWorkerStopped: stopped });
      assert.equal(result.outcome, "held");
      await stillHeld(`unknown-${kind}`);
    }
    await paused("late-effect");
    await assert.rejects(reconcileModelFailure(pool, { buildId: "late-effect", archiveRoot, apply: true,
      verifyWorkerStopped: async function appeared() { await pool.query("insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash) values('late-effect','late',1,'tool',$1)", ["a".repeat(64)]); } }), /non-model operation appeared/);
    await stillHeld("late-effect");
  });
  await t.test("owned cleanup checkpoints source, settles once and preserves publication and unknown model usage", async function settle() {
    const workspace = await paused("settle");
    const name = container(workspace, true);
    await pool.query("update builds set sandbox_id=$2,tokens_in=123,tokens_out=456,cost_usd=1 where id=$1", ["settle", name]);
    let proofs = 0;
    const result = await reconcileModelFailure(pool, { buildId: "settle", archiveRoot, apply: true, verifyWorkerStopped: async function verified() { proofs++; } });
    assert.equal(result.outcome, "applied");
    assert.ok(proofs >= 4);
    const checkpoint = await verifySourceCheckpoint(archiveRoot, result.checkpointHash!);
    assert.equal(checkpoint.manifest.buildId, "settle");
    assert.equal(await readFile(join(checkpoint.path, "files", "App.sol"), "utf8"), await readFile(join(workspace, "App.sol"), "utf8"));
    const row = (await pool.query("select b.status,b.sandbox_id,b.tokens_in,b.tokens_out,b.cost_usd,j.state,j.checkpoint_hash from builds b join build_worker_jobs j on j.build_id=b.id where b.id='settle'")).rows[0];
    assert.deepEqual(row, { status: "failed", sandbox_id: null, tokens_in: null, tokens_out: null, cost_usd: null, state: "completed", checkpoint_hash: result.checkpointHash });
    assert.equal((await pool.query("select receipt->>'usage' usage from build_worker_effects where build_id='settle'")).rows[0].usage, "unknown");
    assert.equal((await pool.query("select preview_url from projects where id='settle'")).rows[0].preview_url, "https://previous.fixture.invalid");
    assert.equal((await reconcileModelFailure(pool, { buildId: "settle", archiveRoot, apply: true, verifyWorkerStopped: stopped })).outcome, "held");
    assert.equal((await pool.query("select count(*)::int n from credit_events where reason='refund'")).rows[0].n, 1);
    assert.equal((await pool.query("select count(*)::int n from build_logs where level='error'")).rows[0].n, 1);
  });
  await t.test("pending Stop keeps its terminal meaning without minting own-key credits", async function stop() {
    await paused("own-stop", true);
    await pool.query("update builds set error=$1 where id='own-stop'", [STOP_REQUESTED]);
    assert.equal((await reconcileModelFailure(pool, { buildId: "own-stop", archiveRoot, apply: true, verifyWorkerStopped: stopped })).outcome, "applied");
    assert.equal((await pool.query("select error from builds where id='own-stop'")).rows[0].error, STOP_REQUESTED);
    assert.equal((await pool.query("select state from build_worker_jobs where build_id='own-stop'")).rows[0].state, "stopped");
    assert.equal((await pool.query("select count(*)::int n from credit_events")).rows[0].n, 0);
  });
  await t.test("missing and symlink workspaces cannot produce a false source checkpoint", async function unavailableSource() {
    const workspace = await paused("missing");
    await rm(workspace, { recursive: true });
    await assert.rejects(reconcileModelFailure(pool, { buildId: "missing", archiveRoot, apply: true, verifyWorkerStopped: stopped }), { code: "ENOENT" });
    await stillHeld("missing");
    await symlink(join(root, "workspaces", "own-stop"), workspace);
    await assert.rejects(reconcileModelFailure(pool, { buildId: "missing", archiveRoot, apply: true, verifyWorkerStopped: stopped }), /symlink/);
    await stillHeld("missing");
  });
});
