import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { executeMaintenance, type MaintenanceCommand } from "../../scripts/build-maintenance";
import { BUILD_CLAIM_LOCK } from "./capacity";

 test("maintenance operator transactions preserve queued and running work and require exact ownership", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function fixture(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString!).hostname));
  const admin = new Pool({ connectionString });
  const namespace = `maintenance_cli_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${namespace}` });
  t.after(async () => { await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await pool.query(`create table app_settings(key text primary key,value text not null,updated_by text,updated_at timestamptz default now());
    create table audit_log(id text primary key,user_id text,actor_type text,action text,resource_type text,resource_id text,metadata jsonb);
    create table builds(id text primary key,status text); create table build_worker_jobs(build_id text,state text);
    insert into builds values('active','building'),('waiting','queued');
    insert into build_worker_jobs values('active','running'),('waiting','queued')`);
  const input = (command: MaintenanceCommand["command"], extra: Partial<MaintenanceCommand> = {}): MaintenanceCommand => ({ command, operationId: "fixture-update", operator: "fixture-root", reason: "Controlled release fixture", ...extra });
  const before = (await pool.query("select * from builds order by id")).rows;
  let publicationChecks = 0;
  async function publicationReady(): Promise<void> { publicationChecks += 1; }

  await t.test("begin is serialized with claims and idempotent under contention", async () => {
    const lock = await pool.connect();
    await lock.query("begin"); await lock.query("select pg_advisory_xact_lock($1)", [BUILD_CLAIM_LOCK]);
    let finished = false;
    const pending = executeMaintenance(pool, input("begin")).then(result => { finished = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 40)); assert.equal(finished, false);
    await lock.query("commit"); lock.release();
    const first = await pending; assert.equal(first.held, true); assert.equal(first.work.running, 1); assert.equal(first.work.queued, 1);
    const repeated = await Promise.all(Array.from({ length: 5 }, () => executeMaintenance(pool, input("begin"))));
    assert.ok(repeated.every(row => !row.changed));
    assert.equal((await pool.query("select count(*)::int n from audit_log")).rows[0].n, 1);
  });
  await t.test("wrong operation cannot overwrite, renew or clear", async () => {
    for (const command of ["begin", "heartbeat", "phase", "clear"] as const) await assert.rejects(executeMaintenance(pool, input(command, { operationId: "different", phase: "updating" }), publicationReady), /Another operation/);
    assert.equal(publicationChecks, 0);
  });
  await t.test("expiry keeps claims held; heartbeat renews without audit spam", async () => {
    await pool.query(`update app_settings set value=jsonb_set(value::jsonb,'{expiresAt}',to_jsonb('2000-01-01T00:00:00.000Z'::text))::text`);
    const stale = await executeMaintenance(pool, { command: "status" }); assert.equal(stale.held, true); assert.equal(stale.maintenance?.stale, true);
    const renewed = await executeMaintenance(pool, input("heartbeat")); assert.equal(renewed.maintenance?.stale, false);
    assert.equal((await pool.query("select count(*)::int n from audit_log")).rows[0].n, 1);
  });
  await t.test("phase changes audit without modifying existing work", async () => {
    const result = await executeMaintenance(pool, input("phase", { phase: "updating" })); assert.equal(result.maintenance?.phase, "updating");
    assert.deepEqual((await pool.query("select * from builds order by id")).rows, before);
    assert.deepEqual((await pool.query("select * from build_worker_jobs order by build_id")).rows, [{ build_id: "active", state: "running" }, { build_id: "waiting", state: "queued" }]);
  });
  await t.test("failed publication verification preserves the owned hold, audit and work", async () => {
    const hold = (await pool.query("select * from app_settings")).rows;
    const audit = (await pool.query("select * from audit_log order by id")).rows;
    await assert.rejects(executeMaintenance(pool, input("clear"), async function unavailable(): Promise<void> {
      throw new Error("Publication helper fixture failed");
    }), /Publication helper fixture failed/);
    assert.deepEqual((await pool.query("select * from app_settings")).rows, hold);
    assert.deepEqual((await pool.query("select * from audit_log order by id")).rows, audit);
    assert.deepEqual((await pool.query("select * from builds order by id")).rows, before);
  });
  await t.test("audit failure rolls back clear; matching clear verifies publication and can be safely repeated", async () => {
    await pool.query("alter table audit_log add constraint refuse_clear check(action <> 'admin.build.maintenance.clear') not valid");
    await assert.rejects(executeMaintenance(pool, input("clear"), publicationReady));
    assert.equal((await executeMaintenance(pool, { command: "status" })).held, true);
    await pool.query("alter table audit_log drop constraint refuse_clear");
    assert.equal((await executeMaintenance(pool, input("clear"), publicationReady)).held, false);
    assert.equal(publicationChecks, 2);
    assert.equal((await executeMaintenance(pool, input("clear"), publicationReady)).changed, false);
    assert.equal(publicationChecks, 2);
    assert.equal((await pool.query("select count(*)::int n from audit_log")).rows[0].n, 3);
  });
  await t.test("malformed persisted values remain held and are never echoed or force-cleared", async () => {
    await pool.query("insert into app_settings(key,value) values('build.maintenance','private-corrupt-content')");
    const result = await executeMaintenance(pool, { command: "status" });
    assert.equal(result.held, true); assert.equal(result.operationId, null); assert.ok(!JSON.stringify(result).includes("private-corrupt-content"));
    await assert.rejects(executeMaintenance(pool, input("clear")), /Malformed/);
    for (const extra of [{ operationId: "../unsafe" }, { leaseSeconds: 0 }, { operator: "" }, { reason: "x" }]) await assert.rejects(executeMaintenance(pool, input("begin", extra)));
  });
});
