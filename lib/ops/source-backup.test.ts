import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { Pool } from "pg";
import { createSourceBackup } from "./source-backup";
import { createSourceCheckpoint, verifySourceCheckpoint } from "@/lib/build/durable/checkpoints";

test("source backup uses verified immutable source and admission locks without archiving credentials", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function integration(t) {
  const fixtureUrl = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(fixtureUrl.hostname), "Source backup fixtures must use a local database.");
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `source_backup_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  const pool = new Pool({ connectionString: url.toString() });
  for (const table of ["user", "projects", "builds", "audit_log"]) await pool.query(`create table "${table}" (like public."${table}" including all)`);
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  const root = await mkdtemp(join(tmpdir(), "fletch-source-backup-"));
  const workspaceRoot = join(root, "workspaces");
  const checkpointRoot = join(root, "checkpoints");
  const destination = join(root, "backups");
  const options = { pool, workspaceRoot, checkpointRoot, destination, maxBytes: 1024 * 1024 };
  t.after(async function cleanup() {
    await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end();
    await rm(root, { recursive: true, force: true });
  });
  async function reset(): Promise<void> {
    await pool.query('truncate build_worker_effects,build_worker_events,build_worker_jobs,builds,projects,audit_log,"user" cascade');
    for (const path of [workspaceRoot, checkpointRoot, destination]) { await rm(path, { recursive: true, force: true }); await mkdir(path, { mode: 0o700 }); }
  }
  async function seed(id: string, status = "succeeded"): Promise<string> {
    await pool.query('insert into "user"(id) values($1)', [id]);
    await pool.query("insert into projects(id,user_id,slug,name) values($1,$1,$1,'Synthetic backup fixture')", [id]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,status) values($1,$1,$1,'Synthetic',$2)", [id, status]);
    const path = join(workspaceRoot, id);
    await mkdir(path); await writeFile(join(path, "App.sol"), "contract App {}\n");
    await writeFile(join(path, ".env"), "PRIVATE_KEY=must-not-copy");
    await mkdir(join(path, ".agent-home")); await writeFile(join(path, ".agent-home", "auth.json"), "must-not-copy");
    return path;
  }
  await t.test("all immutable checkpoints and idle source restore with exact manifests; active/deleting coverage stays explicit", async function complete() {
    await reset();
    const idle = await seed("idle-project");
    const active = await seed("active-project", "building");
    await seed("deleting-project");
    await pool.query("insert into audit_log(id,user_id,actor_type,action) values('project-delete:deleting-project','deleting-project','user','project.delete_requested')");
    const saved = await createSourceCheckpoint({ workspace: active, archiveRoot: checkpointRoot, buildId: "active-build", attempt: 1, stage: "saved", async assertQuiescent() {} });
    await writeFile(join(saved.path, "unlisted-secret"), "must-not-copy");
    const before = (await pool.query("select * from builds order by id")).rows;
    const receipt = await createSourceBackup(options);
    assert.equal(receipt.checkpointCount, 1); assert.equal(receipt.idleWorkspaces, 1); assert.equal(receipt.skipped.active_or_deleting, 2);
    assert.deepEqual((await pool.query("select * from builds order by id")).rows, before);
    assert.equal((await stat(join(destination, receipt.file))).mode & 0o777, 0o600);
    const restored = await mkdtemp(join(root, "restore-"));
    await promisify(execFile)("tar", ["-xzf", join(destination, receipt.file), "-C", restored]);
    for (const hash of await readdir(join(restored, "checkpoints"))) {
      const checkpoint = await verifySourceCheckpoint(join(restored, "checkpoints"), hash);
      assert.deepEqual(checkpoint.manifest.files.map(function path(file) { return file.path; }), ["App.sol"]);
      await assert.rejects(stat(join(checkpoint.path, "unlisted-secret")), { code: "ENOENT" });
    }
    const map = JSON.parse(await readFile(join(restored, "workspace-map.json"), "utf8"));
    assert.equal(map.workspaceMap[0].projectId, "idle-project");
    assert.equal(await readFile(join(idle, "App.sol"), "utf8"), "contract App {}\n");
  });
  await t.test("source backups omit known clean agent session archives with an explicit count", async function sessions() {
    await reset();
    const workspace = await seed("session-project", "building");
    const source = await createSourceCheckpoint({ workspace, archiveRoot: checkpointRoot, buildId: "session-build", attempt: 1, stage: "agent_continuation", async assertQuiescent() {} });
    const sessionRoot = await mkdtemp(join(root, "session-"));
    await writeFile(join(sessionRoot, "continuation.json"), JSON.stringify({ session: { files: { "session.json": "synthetic private session content" } } }));
    const session = await createSourceCheckpoint({ workspace: sessionRoot, archiveRoot: checkpointRoot, buildId: "session-build", attempt: 1, stage: "kimi_0_39_1_clean_step", async assertQuiescent() {} });
    const receipt = await createSourceBackup(options);
    assert.equal(receipt.checkpointCount, 1);
    assert.equal(receipt.skipped.agent_session_checkpoint, 1);
    const restored = await mkdtemp(join(root, "source-only-restore-"));
    await promisify(execFile)("tar", ["-xzf", join(destination, receipt.file), "-C", restored]);
    assert.deepEqual(await readdir(join(restored, "checkpoints")), [source.hash]);
    await verifySourceCheckpoint(join(restored, "checkpoints"), source.hash);
    await assert.rejects(stat(join(restored, "checkpoints", session.hash)), { code: "ENOENT" });
    await verifySourceCheckpoint(checkpointRoot, session.hash);
  });
  await t.test("busy admission lock skips source instead of blocking the account", async function busy() {
    await reset(); await seed("busy-project");
    const client = await pool.connect(); await client.query("begin"); await client.query('select id from "user" where id=\'busy-project\' for update');
    try { const receipt = await createSourceBackup(options); assert.equal(receipt.idleWorkspaces, 0); assert.equal(receipt.skipped.account_busy, 1); }
    finally { await client.query("rollback"); client.release(); }
  });
  await t.test("configured secrets in source abort publication and clean staging", async function secretValue() {
    await reset(); const workspace = await seed("secret-project");
    const secret = "controlled-secret-value-for-backup";
    await writeFile(join(workspace, "App.sol"), `// ${secret}`);
    await assert.rejects(createSourceBackup({ ...options, forbiddenValues: [secret] }), /configured secret/);
    assert.deepEqual(await readdir(destination), []);
    assert.ok((await readFile(join(workspace, "App.sol"), "utf8")).includes(secret));
  });
  await t.test("unrecognized credential filenames fail closed", async function secretFile() {
    await reset(); const workspace = await seed("credential-project");
    await writeFile(join(workspace, ".npmrc"), "auth-token=synthetic");
    await assert.rejects(createSourceBackup(options), /credential filename/);
    assert.deepEqual(await readdir(destination), []);
  });
  await t.test("retention removes only expired scheduled source archives after success", async function retention() {
    await reset();
    const expired = "fletch-sources-20200101-000000-000.tar.gz";
    const manual = "manual-release.tar.gz";
    for (const file of [expired, `${expired}.json`, manual]) {
      await writeFile(join(destination, file), "fixture");
      await utimes(join(destination, file), 1, 1);
    }
    const receipt = await createSourceBackup(options);
    assert.deepEqual((await readdir(destination)).sort(), [manual, receipt.file, `${receipt.file}.json`].sort());
  });
  await t.test("destination symlink cannot overlap live storage", async function alias() {
    await reset();
    const alias = join(root, "source-alias");
    await symlink(workspaceRoot, alias);
    await assert.rejects(createSourceBackup({ ...options, destination: alias }), /separate from live storage/);
  });
  await t.test("tampered immutable checkpoint cannot become a verified backup", async function tamper() {
    await reset(); const workspace = await seed("tamper-project");
    const checkpoint = await createSourceCheckpoint({ workspace, archiveRoot: checkpointRoot, buildId: "fixture", attempt: 1, stage: "saved", async assertQuiescent() {} });
    const path = join(checkpoint.path, "files", "App.sol"); await chmod(path, 0o600); await writeFile(path, "altered");
    await assert.rejects(createSourceBackup(options), /hash mismatch/);
    assert.deepEqual(await readdir(destination), []);
  });
});
