import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";

test("worker publication Stop completes only after restoring the previous release", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function publication(t) {
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const admin = new Pool({ connectionString: url.toString() });
  const namespace = `worker_publish_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-worker-publication-")));
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, { DATABASE_URL: url.toString(), MOONSHOT_API_KEY: "unused-controlled-key",
    FORGE_WORKSPACE_ROOT: join(root, "workspaces"), FORGE_CHECKPOINT_ROOT: join(root, "checkpoints"), FORGE_SITES_ROOT: join(root, "sites"), PATH: `${join(root, "bin")}:${env.PATH}` });
  const { pool, close } = await import("@/lib/db");
  const { enrollWorkerBuild } = await import("./ownership");
  const { runBuildWorkerOnce } = await import("./runner");
  const { currentWorkerExecution } = await import("./execution");
  const { publishSite } = await import("@/lib/hosting/publish");
  const { requestBuildStop } = await import("@/lib/build/queue");
  t.after(async function cleanup() {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  for (const table of ["audit_log", "builds", "build_logs", "credit_events", "projects", "contracts", "wallet_address", "app_settings"]) await pool.query(`create table ${table} (like public.${table} including all)`);
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await mkdir(join(root, "bin"));
  await writeFile(join(root, "bin", "sudo"), "#!/bin/sh\nexit 0\n");
  await chmod(join(root, "bin", "sudo"), 0o755);
  for (const mode of ["stopped", "unknown", "preparation-failure"] as const) {
    await t.test(`publication boundary: ${mode}`, async function scenario() {
      const brokenRollback = mode === "unknown";
      const held = mode === "unknown";
      const id = `publication-${mode}`;
      const site = join(root, "sites", id);
      const workspace = join(root, "workspaces", id);
      await mkdir(join(site, "previous"), { recursive: true });
      await mkdir(join(workspace, "dist"), { recursive: true });
      await writeFile(join(workspace, "Saved.sol"), "saved source");
      await writeFile(join(workspace, "dist", "index.html"), "candidate");
      await writeFile(join(site, "previous", "index.html"), "previous good preview");
      await symlink("previous", join(site, "current"));
      await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,'owner',$1,'Fixture','https://previous.invalid')", [id]);
      await pool.query("insert into builds(id,user_id,project_id,prompt,billing_mode,custody_mode,model) values($1,'owner',$1,'Fixture','platform','platform','kimi-k3')", [id]);
      await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,'owner',$1,-1,'build_debit',$2)", [id, `build_debit:${id}`]);
      await enrollWorkerBuild(pool, id);
      if (mode === "preparation-failure") {
        await pool.query(`create function reject_publication_preparation() returns trigger language plpgsql as $$
          begin if new.kind='publication_prepared' then raise exception 'controlled preparation failure'; end if; return new; end $$`);
        await pool.query("create trigger reject_publication_preparation before insert on build_worker_events for each row execute function reject_publication_preparation()");
      }
      let requests = 0;
      globalThis.fetch = async function verify(): Promise<Response> {
        requests++;
        assert.equal((await pool.query("select count(*)::int as n from build_worker_events where build_id=$1 and kind='publication_prepared'", [id])).rows[0].n, 1);
        assert.equal(await readlink(join(site, "current")), id);
        await requestBuildStop(id, "owner");
        const signal = currentWorkerExecution()!.signal;
        if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        if (brokenRollback) {
          await rm(join(site, "current"));
          await mkdir(join(site, "current"));
        }
        return new Response("controlled", { status: 200 });
      };
      const outcome = await runBuildWorkerOnce("fixture", { heartbeatMs: 20, leaseMs: 2000, builder() {
        return { async *run() {
          const result = await publishSite(id, id, join(workspace, "dist"), 9);
          yield { phase: result.ok ? "done" : "error", text: "Controlled publication" };
        } };
      } });
      let expected = "completed";
      if (held) expected = "recovery_required";
      if (mode === "stopped") expected = "stopped";
      assert.equal(outcome, expected);
      assert.equal((await pool.query("select state from build_worker_effects where build_id=$1", [id])).rows[0].state, held ? "uncertain" : "completed");
      assert.equal((await pool.query("select sum(delta)::int as credits from credit_events where build_id=$1", [id])).rows[0].credits, held ? -1 : 0);
      assert.equal((await pool.query("select preview_url from projects where id=$1", [id])).rows[0].preview_url, "https://previous.invalid");
      assert.equal(await readFile(join(workspace, "Saved.sol"), "utf8"), "saved source");
      assert.equal(await readFile(join(site, "previous", "index.html"), "utf8"), "previous good preview");
      if (!brokenRollback) assert.equal(await readlink(join(site, "current")), "previous");
      if (mode === "preparation-failure") {
        assert.equal(requests, 0);
        await assert.rejects(readFile(join(site, id, "index.html")), { code: "ENOENT" });
      }
    });
  }
});
