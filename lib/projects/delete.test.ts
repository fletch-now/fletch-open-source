import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";

test("project deletion retains durable receipts and money with retryable filesystem cleanup", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `project_delete_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  process.env.MOONSHOT_API_KEY = "controlled-unused-provider-key";
  process.env.FORGE_BUILD_EXECUTION = "worker";
  const root = await mkdtemp(join(tmpdir(), "fletch-project-deletion-"));
  process.env.FORGE_WORKSPACE_ROOT = join(root, "workspaces");
  process.env.FORGE_SITES_ROOT = join(root, "sites");
  process.env.FORGE_CHECKPOINT_ROOT = join(root, "checkpoints");
  const { pool, close } = await import("@/lib/db");
  const { deleteProject, ProjectDeletionError } = await import("./delete");
  const { withSiteLock } = await import("@/lib/hosting/site-lock");
  const { createFollowUpBuild } = await import("@/lib/build/create");
  for (const table of ["user", "projects", "builds", "build_logs", "contracts", "credit_events", "audit_log", "app_settings"]) {
    await pool.query(`create table "${table}" (like public."${table}" including all)`);
  }
  // LIKE omits foreign keys: install the actual cascade that exposed the durable RESTRICT.
  await pool.query(`alter table projects add foreign key(user_id) references "user"(id) on delete cascade;
    alter table builds add foreign key(project_id) references projects(id) on delete cascade;
    alter table builds add foreign key(user_id) references "user"(id) on delete cascade;
    alter table build_logs add foreign key(build_id) references builds(id) on delete cascade;
    alter table contracts add foreign key(build_id) references builds(id) on delete cascade;
    alter table credit_events add foreign key(user_id) references "user"(id) on delete cascade;
    alter table audit_log add foreign key(user_id) references "user"(id) on delete set null;`);
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  await pool.query(await readFile("drizzle/0066_site_drafts.sql", "utf8"));
  t.after(async function cleanup() {
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    await rm(root, { recursive: true, force: true });
  });

  async function seed(): Promise<{ id: string; owner: string; slug: string; source: string; site: string; checkpoint: string }> {
    const id = randomUUID();
    const owner = `owner-${id}`;
    const slug = `app-${id}`;
    await pool.query('insert into "user"(id) values($1)', [owner]);
    await pool.query("insert into projects(id,user_id,slug,name,preview_url) values($1,$2,$3,'Fixture','https://previous.fixture.invalid')", [id, owner, slug]);
    await pool.query("insert into builds(id,user_id,project_id,prompt,status,billing_mode) values($1,$2,$1,'Synthetic saved brief','succeeded','platform')", [id, owner]);
    await pool.query("insert into build_worker_jobs(build_id,workspace_key,state,checkpoint_hash) values($1,$2,'completed',$3)", [id, `project:${id}`, "a".repeat(64)]);
    await pool.query("insert into build_worker_events(build_id,seq,attempt,kind,detail) values($1,1,1,'settled','{}')", [id]);
    await pool.query("insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash,state,receipt) values($1,'deployment',1,'deployment',$2,'completed','{\"txHash\":\"synthetic\"}')", [id, "a".repeat(64)]);
    await pool.query("insert into build_logs(id,build_id,seq,chunk) values($1,$1,1,'Saved result')", [id]);
    await pool.query("insert into contracts(id,build_id,chain_id,address,tx_hash) values($1,$1,46630,$2,'synthetic')", [id, `0x${"1".repeat(40)}`]);
    await pool.query("insert into credit_events(id,user_id,build_id,delta,reason,idempotency_key) values($1,$2,$3,-1,'build_debit',$1),($4,$2,$3,1,'refund',$4),($5,$2,null,3,'free_grant',$5)", [`debit-${id}`, owner, id, `refund-${id}`, `grant-${id}`]);
    const source = join(process.env.FORGE_WORKSPACE_ROOT!, slug, "App.sol");
    const site = join(process.env.FORGE_SITES_ROOT!, slug, "index.html");
    const checkpoint = join(process.env.FORGE_CHECKPOINT_ROOT!, id, "App.sol");
    for (const path of [source, site, checkpoint]) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "retained fixture");
    }
    return { id, owner, slug, source, site, checkpoint };
  }

  async function money(owner: string): Promise<unknown[]> {
    return (await pool.query("select * from credit_events where user_id=$1 order by id", [owner])).rows;
  }

  async function projectExists(id: string): Promise<boolean> {
    return (await pool.query("select 1 from projects where id=$1", [id])).rows.length === 1;
  }

  await t.test("a queued publication blocks deletion and preserves its saved preview", async function publishing() {
    const fixture = await seed();
    await pool.query("insert into site_drafts(build_id,project_id,slug,manifest,bytes) values($1,$1,$2,'{}',1)", [fixture.id, fixture.slug]);
    await pool.query("insert into site_publications(build_id,project_id,state) values($1,$1,'queued')", [fixture.id]);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), /app is publishing/);
    assert.equal(await projectExists(fixture.id), true);
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
    await pool.query("update site_publications set state='failed' where build_id=$1", [fixture.id]);
    assert.equal((await deleteProject(fixture.owner, fixture.id))?.ok, true);
    assert.equal((await pool.query("select 1 from site_drafts where build_id=$1", [fixture.id])).rows.length, 0);
  });

  await t.test("deletion waits for the site owner before removing any project files", async function ownedSite() {
    const fixture = await seed();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const owner = withSiteLock(process.env.FORGE_SITES_ROOT!, fixture.slug, async function hold() {
      entered.resolve(); await release.promise;
    }, { database: pool });
    await entered.promise;
    const deletion = deleteProject(fixture.owner, fixture.id);
    try {
      await delay(150);
      assert.equal(await readFile(fixture.site, "utf8"), "retained fixture");
      assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
      assert.equal((await pool.query("select count(*)::int as n from projects where id=$1", [fixture.id])).rows[0].n, 1);
    } finally { release.resolve(); }
    await owner;
    assert.equal((await deletion)?.ok, true);
    await assert.rejects(readFile(fixture.site), { code: "ENOENT" });
  });

  await t.test("actual cascade fails with RESTRICT; safe deletion keeps every execution row and ledger byte", async function retention() {
    const fixture = await seed();
    const before = await money(fixture.owner);
    await assert.rejects(pool.query("delete from projects where id=$1", [fixture.id]), function restricted(error: unknown): boolean {
      // PostgreSQL 18 reports RESTRICT as 23001; earlier releases use 23503.
      const failure = error as { code?: string; constraint?: string };
      return ["23001", "23503"].includes(failure.code ?? "") && failure.constraint === "build_worker_jobs_build_id_fkey";
    });
    const deleted = await deleteProject(fixture.owner, fixture.id);
    assert.equal(deleted?.ok, true);
    assert.ok(deleted!.freedBytes > 0);
    assert.equal(await projectExists(fixture.id), false);
    assert.equal((await pool.query("select project_id from builds where id=$1", [fixture.id])).rows[0].project_id, null);
    for (const table of ["build_logs", "contracts", "build_worker_jobs", "build_worker_events", "build_worker_effects"]) {
      assert.equal((await pool.query(`select count(*)::int n from ${table} where build_id=$1`, [fixture.id])).rows[0].n, 1, table);
    }
    assert.deepEqual((await pool.query("select metadata from audit_log where id=$1", [`project-deleted:${fixture.id}`])).rows[0].metadata.buildIds, [fixture.id]);
    assert.deepEqual(await money(fixture.owner), before);
    await assert.rejects(readFile(fixture.source), { code: "ENOENT" });
    await assert.rejects(readFile(fixture.site), { code: "ENOENT" });
    assert.equal(await readFile(fixture.checkpoint, "utf8"), "retained fixture");
    assert.deepEqual(await deleteProject(fixture.owner, fixture.id), deleted);
  });

  await t.test("another owner cannot delete or infer completed deletion", async function ownership() {
    const fixture = await seed();
    await pool.query('insert into "user"(id) values($1)', [`other-${fixture.id}`]);
    assert.equal(await deleteProject(`other-${fixture.id}`, fixture.id), null);
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
    await deleteProject(fixture.owner, fixture.id);
    assert.equal(await deleteProject(`other-${fixture.id}`, fixture.id), null);
  });

  for (const status of ["queued", "provisioning", "building", "compiling"]) {
    await t.test(`${status} builds keep all files and create no deletion intent`, async function active() {
      const fixture = await seed();
      await pool.query("update builds set status=$2 where id=$1", [fixture.id, status]);
      await assert.rejects(deleteProject(fixture.owner, fixture.id), function conflict(error: unknown) {
        return error instanceof ProjectDeletionError && error.status === 409;
      });
      assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
      assert.equal((await pool.query("select 1 from audit_log where resource_id=$1", [fixture.id])).rows.length, 0);
    });
  }

  await t.test("terminal build still refuses queued/running/recovery jobs, retained leases and uncertain effects", async function unsafe() {
    const fixture = await seed();
    for (const state of ["queued", "running", "recovery_required"]) {
      await pool.query("update build_worker_jobs set state=$2,owner_id='owner',fence='fence',lease_expires_at=clock_timestamp()+interval '1 minute' where build_id=$1", [fixture.id, state]);
      await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 409 });
    }
    await pool.query("update build_worker_jobs set state='completed' where build_id=$1", [fixture.id]);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 409 });
    await pool.query("update build_worker_jobs set lease_expires_at=null where build_id=$1", [fixture.id]);
    for (const kind of ["model", "tool", "deployment", "publication"]) {
      await pool.query("update build_worker_effects set state='uncertain',kind=$2 where build_id=$1", [fixture.id, kind]);
      await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 409 });
    }
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
  });

  await t.test("workspace ownership is guarded even when the active job's build is detached", async function workspaceOwner() {
    const fixture = await seed();
    await pool.query("update builds set project_id=null where id=$1", [fixture.id]);
    await pool.query("update build_worker_jobs set state='recovery_required' where build_id=$1", [fixture.id]);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 409 });
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
  });

  await t.test("filesystem failure preserves durable intent and blocks real admission before selection/debit; retry completes", async function retry() {
    const fixture = await seed();
    const before = await money(fixture.owner);
    await assert.rejects(deleteProject(fixture.owner, fixture.id, { async removeTree(path) {
      if (path.startsWith(process.env.FORGE_SITES_ROOT!)) throw new Error("Controlled disk failure");
      await rm(path, { recursive: true, force: true });
      return 0;
    } }), /Controlled disk failure/);
    assert.equal(await projectExists(fixture.id), true);
    assert.equal((await pool.query("select 1 from audit_log where id=$1", [`project-delete:${fixture.id}`])).rows.length, 1);
    await assert.rejects(createFollowUpBuild(fixture.owner, fixture.id, "Synthetic follow-up"), { status: 409 });
    assert.deepEqual(await money(fixture.owner), before);
    assert.equal((await pool.query("select count(*)::int n from builds where user_id=$1", [fixture.owner])).rows[0].n, 1);
    await promisify(execFile)(process.execPath, ["--import", "tsx", "-e", `
      require('./lib/test-server-only.ts');
      const {deleteProject}=require('./lib/projects/delete.ts');
      deleteProject(${JSON.stringify(fixture.owner)},${JSON.stringify(fixture.id)})
        .then(result=>{if(!result?.ok)throw new Error('Retry did not complete')})
        .finally(()=>require('./lib/db/index.ts').close());
    `], { env: process.env });
    assert.equal(await projectExists(fixture.id), false);
    assert.equal(await readFile(fixture.checkpoint, "utf8"), "retained fixture");
    assert.deepEqual(await money(fixture.owner), before);
  });

  await t.test("a failed final commit leaves intent and slug reserved for a safe retry", async function commitFailure() {
    const fixture = await seed();
    const before = await money(fixture.owner);
    await pool.query(`create function reject_fixture_delete() returns trigger language plpgsql as $$begin
      if old.id='${fixture.id}' then raise exception 'Controlled commit failure'; end if; return old; end$$;
      create constraint trigger reject_fixture_delete after delete on projects deferrable initially deferred
      for each row execute function reject_fixture_delete();`);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), function commitError(error: unknown) {
      return error instanceof Error && error.cause instanceof Error && error.cause.message === "Controlled commit failure";
    });
    assert.equal(await projectExists(fixture.id), true);
    assert.equal((await pool.query("select project_id from builds where id=$1", [fixture.id])).rows[0].project_id, fixture.id);
    await assert.rejects(createFollowUpBuild(fixture.owner, fixture.id, "Synthetic follow-up"), { status: 409 });
    assert.deepEqual(await money(fixture.owner), before);
    await pool.query("drop trigger reject_fixture_delete on projects; drop function reject_fixture_delete()");
    await deleteProject(fixture.owner, fixture.id);
    assert.equal(await projectExists(fixture.id), false);
  });

  await t.test("parallel DELETE and admission serialize; a completed retry never touches a reused slug", async function concurrent() {
    const fixture = await seed();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(function wait(resolve) { release = resolve; });
    const ready = new Promise<void>(function wait(resolve) { entered = resolve; });
    let calls = 0;
    const deleting = deleteProject(fixture.owner, fixture.id, { async removeTree(path) {
      calls += 1;
      if (calls === 1) { entered(); await gate; }
      await rm(path, { recursive: true, force: true });
      return 0;
    } });
    await ready;
    let retryFinished = false;
    const retry = deleteProject(fixture.owner, fixture.id).then(function done(result) { retryFinished = true; return result; });
    let admissionFinished = false;
    const admission = createFollowUpBuild(fixture.owner, fixture.id, "Synthetic follow-up").then(function unexpected() {
      admissionFinished = true;
      throw new Error("Admission should reject a deleting project");
    }, function rejected(error: unknown) { admissionFinished = true; return error; });
    await delay(75);
    assert.equal(retryFinished, false);
    assert.equal(admissionFinished, false);
    release();
    const result = await deleting;
    assert.deepEqual(await retry, result);
    assert.ok((await admission) instanceof ProjectDeletionError);
    assert.equal(calls, 3);
    await pool.query("insert into projects(id,user_id,slug,name) values($1,$2,$3,'Reused fixture slug')", [randomUUID(), fixture.owner, fixture.slug]);
    await mkdir(join(fixture.source, ".."), { recursive: true });
    await writeFile(fixture.source, "new project contents");
    assert.deepEqual(await deleteProject(fixture.owner, fixture.id, { async removeTree() { throw new Error("Must not revisit reused slug"); } }), result);
    assert.equal(await readFile(fixture.source, "utf8"), "new project contents");
  });

  await t.test("real admission winning first makes deletion refuse without charging again", async function admissionFirst() {
    const fixture = await seed();
    const created = await createFollowUpBuild(fixture.owner, fixture.id, "Synthetic follow-up, no execution");
    assert.ok(created?.buildId);
    const before = await money(fixture.owner);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 409 });
    assert.deepEqual(await money(fixture.owner), before);
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
  });

  await t.test("an invalid slug cannot escape the configured roots", async function invalidPath() {
    const fixture = await seed();
    await pool.query("update projects set slug='../checkpoints' where id=$1", [fixture.id]);
    await assert.rejects(deleteProject(fixture.owner, fixture.id), { status: 400 });
    assert.equal(await readFile(fixture.source, "utf8"), "retained fixture");
    assert.equal(await readFile(fixture.checkpoint, "utf8"), "retained fixture");
  });

  await t.test("a workspace-root symlink never removes its target or checkpoint archives", async function symlinkSafety() {
    const fixture = await seed();
    await rm(join(fixture.source, ".."), { recursive: true });
    await symlink(join(fixture.checkpoint, ".."), join(fixture.source, ".."));
    await deleteProject(fixture.owner, fixture.id);
    assert.equal(await readFile(fixture.checkpoint, "utf8"), "retained fixture");
  });
});
