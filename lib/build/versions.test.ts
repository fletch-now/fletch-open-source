import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool } from "pg";
import { createSourceCheckpoint, restoreSourceCheckpoint } from "./durable/checkpoints";

test("version history restores immutable source copies with owner scope, idempotency and retained build context", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `versions_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.MOONSHOT_API_KEY = "unused-controlled-key";
  process.env.FORGE_BUILD_EXECUTION = "worker";
  const root = await realpath(await mkdtemp(join(tmpdir(), "fletch-versions-")));
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const { pool, close } = await import("@/lib/db");
  const { listProjectVersions, getProjectVersion, getProjectVersionFile, restoreProjectVersion } = await import("./versions");
  const { recoverBuildBrief } = await import("./recover-brief");
  const { createFollowUpBuild } = await import("./create");
  const { loadProjectThread } = await import("./history");
  for (const table of ["user", "projects", "builds", "build_logs", "contracts", "credit_events", "audit_log", "app_settings"]) {
    await pool.query(`create table "${table}" (like public."${table}" including all)`);
  }
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  t.after(async function cleanup() {
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });

  async function seed(): Promise<{ owner: string; projectId: string; buildId: string; workspace: string; hash: string }> {
    const projectId = randomUUID();
    const owner = `owner-${projectId}`;
    const buildId = randomUUID();
    const workspace = join(process.env.FORGE_WORKSPACE_ROOT!, projectId);
    await mkdir(join(workspace, "src"), { recursive: true });
    await mkdir(join(workspace, ".agent-home"));
    await writeFile(join(workspace, "src", "App.tsx"), "export const saved = 'version one';");
    await writeFile(join(workspace, ".env"), "PRIVATE=fixture");
    await writeFile(join(workspace, ".agent-home", "session.json"), "private coding session");
    const checkpoint = await createSourceCheckpoint({ workspace, archiveRoot: process.env.FORGE_CHECKPOINT_ROOT!, buildId, attempt: 1, stage: "finished", async assertQuiescent() {} });
    await pool.query('insert into "user"(id) values($1)', [owner]);
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,$2,$1,'Original','https://original.invalid')", [projectId, owner]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,status,started_at,created_at,attachments) values($1,$2,$3,'Original objective: saved brief/pasted-brief.txt','succeeded',now()-interval '3 minute',now()-interval '3 minute',$4)", [`first-${buildId}`, owner, projectId, JSON.stringify([{ name: "pasted-brief.txt", content: "Original complete brief" }])]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,status,started_at,created_at) values($1,$2,$3,'Selected change: add a search field','succeeded',now()-interval '2 minute',now()-interval '2 minute')", [buildId, owner, projectId]);
    await pool.query("insert into build_worker_jobs(build_id,workspace_key,state,checkpoint_hash) values($1,$2,'completed',$3)", [buildId, `project:${projectId}`, checkpoint.hash]);
    await pool.query("insert into credit_events(id,user_id,delta,reason,idempotency_key) values($1,$2,5,'free_grant',$1)", [randomUUID(), owner]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,status,started_at,created_at,attachments) values($1,$2,$3,'LATER changes must not enter the copy','succeeded',now()-interval '1 minute',now()-interval '1 minute',$4)", [`later-${buildId}`, owner, projectId, JSON.stringify([{ name: "pasted-brief.txt", content: "LATER replacement" }])]);
    await writeFile(join(workspace, "src", "App.tsx"), "newer live progress");
    return { owner, projectId, buildId, workspace, hash: checkpoint.hash };
  }

  await t.test("owner checks cover lists, source reads and restores, including mismatched builds and traversal", async function ownership() {
    const a = await seed();
    const b = await seed();
    assert.equal(await listProjectVersions(b.owner, a.projectId), null);
    assert.equal(await getProjectVersion(b.owner, a.projectId, a.buildId), null);
    assert.equal(await getProjectVersionFile(b.owner, a.projectId, a.buildId, "src/App.tsx"), null);
    assert.equal(await restoreProjectVersion(b.owner, a.projectId, a.buildId, randomUUID(), a.hash), null);
    assert.equal(await getProjectVersion(a.owner, a.projectId, b.buildId), null);
    await assert.rejects(getProjectVersionFile(a.owner, a.projectId, a.buildId, "../.env"), /Invalid source path/);
    await pool.query("update build_worker_jobs set checkpoint_hash=$2 where build_id=$1", [a.buildId, b.hash]);
    assert.equal((await getProjectVersion(a.owner, a.projectId, a.buildId))?.sourceAvailable, false);
    await assert.rejects(restoreProjectVersion(a.owner, a.projectId, a.buildId, randomUUID(), b.hash), /could not be verified/);
  });

  await t.test("concurrent duplicate restore copies once, retains active ownership and charges nothing", async function concurrent() {
    const fixture = await seed();
    assert.equal(await getProjectVersionFile(fixture.owner, fixture.projectId, fixture.buildId, "src/App.tsx"), "export const saved = 'version one';");
    await pool.query("update builds set status='building' where id=$1", [`later-${fixture.buildId}`]);
    await pool.query("insert into build_worker_jobs(build_id,workspace_key,state,owner_id,fence,lease_expires_at) values($1,$2,'running','worker','fence',now()+interval '1 hour')", [`later-${fixture.buildId}`, `project:${fixture.projectId}`]);
    const before = (await pool.query("select * from build_worker_jobs where workspace_key=$1 order by build_id", [`project:${fixture.projectId}`])).rows;
    const money = (await pool.query("select * from credit_events where user_id=$1", [fixture.owner])).rows;
    const requestId = randomUUID();
    let copies = 0;
    async function copy(...args: Parameters<typeof restoreSourceCheckpoint>): ReturnType<typeof restoreSourceCheckpoint> {
      copies++;
      return restoreSourceCheckpoint(...args);
    }
    const results = await Promise.all([1, 2].map(function restore() {
      return restoreProjectVersion(fixture.owner, fixture.projectId, fixture.buildId, requestId, fixture.hash, { restoreSource: copy });
    }));
    assert.deepEqual(results[0], results[1]);
    assert.equal(copies, 1);
    const result = results[0]!;
    assert.equal(await readFile(join(process.env.FORGE_WORKSPACE_ROOT!, result.slug, "src", "App.tsx"), "utf8"), "export const saved = 'version one';");
    assert.equal(await readFile(join(fixture.workspace, "src", "App.tsx"), "utf8"), "newer live progress");
    await assert.rejects(readFile(join(process.env.FORGE_WORKSPACE_ROOT!, result.slug, ".env")), { code: "ENOENT" });
    await assert.rejects(readFile(join(process.env.FORGE_WORKSPACE_ROOT!, result.slug, ".agent-home", "session.json")), { code: "ENOENT" });
    assert.deepEqual((await pool.query("select * from build_worker_jobs where workspace_key=$1 order by build_id", [`project:${fixture.projectId}`])).rows, before);
    assert.deepEqual((await pool.query("select * from credit_events where user_id=$1", [fixture.owner])).rows, money);
    assert.equal((await pool.query("select * from builds where project_id=$1", [result.projectId])).rows.length, 0);
    assert.equal((await pool.query("select preview_url from projects where id=$1", [result.projectId])).rows[0].preview_url, null);
    assert.equal((await pool.query("select preview_url from projects where id=$1", [fixture.projectId])).rows[0].preview_url, "https://original.invalid");
    assert.match((await loadProjectThread(result.projectId, fixture.owner))[0].content, /Restored the saved source/);
    assert.equal((await listProjectVersions(fixture.owner, result.projectId))?.[0].status, "restored");
    await assert.rejects(restoreProjectVersion(fixture.owner, fixture.projectId, `later-${fixture.buildId}`, requestId, fixture.hash), /another version/);
  });

  await t.test("a real accepted follow-up starts on the copied files with the selected brief, never later changes", async function followUp() {
    const fixture = await seed();
    const copy = (await restoreProjectVersion(fixture.owner, fixture.projectId, fixture.buildId, randomUUID(), fixture.hash))!;
    const accepted = await createFollowUpBuild(fixture.owner, copy.projectId, "Continue from this source.");
    assert.ok(accepted);
    const input = await recoverBuildBrief(pool, { buildId: accepted.buildId, slug: accepted.slug, prompt: "Continue from this source.", ownerAddress: null }, fixture.owner, copy.projectId);
    assert.deepEqual(input.projectRequests, ["Original objective: saved brief/pasted-brief.txt", "Selected change: add a search field"]);
    assert.deepEqual(input.attachments, [{ name: "pasted-brief.txt", content: "Original complete brief" }]);
    assert.equal(await readFile(join(process.env.FORGE_WORKSPACE_ROOT!, accepted.slug, "src", "App.tsx"), "utf8"), "export const saved = 'version one';");
    assert.equal((await pool.query("select agent_session_id,sandbox_id from builds where id=$1", [accepted.buildId])).rows[0].agent_session_id, null);
  });

  await t.test("changed selections, corrupt snapshots and symlinks fail without publishing a copy", async function failures() {
    const fixture = await seed();
    await assert.rejects(restoreProjectVersion(fixture.owner, fixture.projectId, fixture.buildId, randomUUID(), "a".repeat(64)), /saved source changed/);
    const file = join(process.env.FORGE_CHECKPOINT_ROOT!, fixture.hash, "files", "src", "App.tsx");
    await chmod(file, 0o600);
    await writeFile(file, "tampered");
    await assert.rejects(restoreProjectVersion(fixture.owner, fixture.projectId, fixture.buildId, randomUUID(), fixture.hash), /could not be verified/);
    await rm(file);
    await symlink(join(fixture.workspace, ".env"), file);
    await assert.rejects(restoreProjectVersion(fixture.owner, fixture.projectId, fixture.buildId, randomUUID(), fixture.hash), /could not be verified/);
    assert.equal((await pool.query("select count(*)::int n from projects where user_id=$1", [fixture.owner])).rows[0].n, 1);
    assert.equal(await readFile(join(fixture.workspace, "src", "App.tsx"), "utf8"), "newer live progress");
  });
});
