import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { withResourceLock } from "./resource-lock";
import { sweepSiteReleases } from "./reaper";
import { withSiteLock } from "@/lib/hosting/site-lock";

test("external-operation locks coordinate real PostgreSQL sessions without occupying a connection per waiter", { skip: !process.env.FLETCH_TEST_DATABASE_URL, timeout: 20_000 }, async function resources(t) {
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  assert.ok(["127.0.0.1", "localhost"].includes(url.hostname));
  const admin = new Pool({ connectionString: url.toString() });
  const schema = `resource_locks_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${schema}`);
  url.searchParams.set("options", `-c search_path=${schema},public`);
  const database = new Pool({ connectionString: url.toString(), application_name: schema, max: 1 });
  const other = new Pool({ connectionString: url.toString(), application_name: schema, max: 1 });
  const root = await mkdtemp(join(tmpdir(), "fletch-resource-locks-"));
  try {
    await database.query("create table build_worker_effects(build_id text,attempt integer,effect_key text,kind text,state text); create table build_worker_events(build_id text,attempt integer,kind text,detail jsonb)");
    await t.test("50 blocked contenders remain cancellable and leave the main pool available", async function waiters() {
      const gate = Promise.withResolvers<void>();
      const entered = Promise.withResolvers<void>();
      const key = `fixture:${schema}`;
      const owner = withResourceLock(key, async function held() { entered.resolve(); await gate.promise; }, { database });
      await entered.promise;
      const stop = new AbortController();
      const waiting = Array.from({ length: 50 }, () => withResourceLock(key, async function forbidden() { assert.fail("Stopped waiters must not dispatch"); }, { database, signal: stop.signal }));
      const settled = Promise.allSettled(waiting);
      await delay(250);
      const sessions = await admin.query("select count(*)::int as n from pg_stat_activity where application_name=$1", [schema]);
      assert.ok(sessions.rows[0].n <= 5, "One ordinary and at most four coordination sessions");
      assert.equal((await database.query("select 1 as available")).rows[0].available, 1);
      assert.equal(await withResourceLock(key, async function busy() { return true; }, { database: other, skipBusy: true }), undefined);
      stop.abort(new Error("Stop waiting"));
      const results = await settled;
      assert.equal(results.filter((r) => r.status === "rejected").length, 50);
      gate.resolve(); await owner;
      assert.equal(await withResourceLock(key, async function successor() { return "next"; }, { database: other }), "next");
    });
    await t.test("lock loss cancels the owned operation and a successor can acquire", async function lost() {
      const entered = Promise.withResolvers<number>();
      const key = `lost:${schema}`;
      const owner = withResourceLock(key, async function hold(signal) {
        const sessions = await admin.query("select pid from pg_stat_activity where application_name=$1 and pid in (select pid from pg_locks where locktype='advisory')", [schema]);
        entered.resolve(sessions.rows[0].pid);
        await delay(10_000, undefined, { signal });
      }, { database });
      const rejected = assert.rejects(owner, /abort|lock was lost/i);
      const pid = await entered.promise;
      await admin.query("select pg_terminate_backend($1)", [pid]);
      await rejected;
      assert.equal(await withResourceLock(key, async function next() { return "recovered"; }, { database: other }), "recovered");
    });
    await t.test("sweep cannot remove a confirmed rollback target during publication or unresolved recovery", async function sweep() {
      const slug = "owned-fixture";
      const site = join(root, slug);
      await mkdir(site);
      for (const [index, name] of ["confirmed", "failed-a", "failed-b", "provisional"].entries()) {
        const path = join(site, name); await mkdir(path); await writeFile(join(path, "index.html"), name); await utimes(path, 100 + index, 100 + index);
      }
      await symlink("provisional", join(site, "current"));
      await withSiteLock(root, slug, async function publication() {
        assert.deepEqual(await sweepSiteReleases(root, 2, other), { removed: 0 });
        assert.equal(await readFile(join(site, "confirmed", "index.html"), "utf8"), "confirmed");
      }, { database });
      await database.query("insert into build_worker_effects values('build',1,'publication','publication','uncertain'); insert into build_worker_events values('build',1,'publication_prepared','{\"effectKey\":\"publication\",\"slug\":\"owned-fixture\",\"previousRelease\":\"confirmed\"}')");
      assert.deepEqual(await sweepSiteReleases(root, 2, other), { removed: 0 });
      await withSiteLock(root, slug, async function reconcile() {
        await rm(join(site, "current")); await symlink("confirmed", join(site, "current"));
        await database.query("update build_worker_effects set state='completed'");
      }, { database });
      assert.deepEqual(await sweepSiteReleases(root, 2, other), { removed: 1 });
      assert.equal(await readFile(join(site, "current", "index.html"), "utf8"), "confirmed");
    });
  } finally {
    await database.end(); await other.end();
    await admin.query(`drop schema ${schema} cascade`); await admin.end();
    await rm(root, { recursive: true, force: true });
  }
});
