import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { BUILD_MAINTENANCE_KEY, parseBuildMaintenance, readBuildMaintenance } from "./maintenance";
import { claimWorkerBuild, enrollWorkerBuild, heartbeatWorker } from "./durable/ownership";

const record = { version: 1, operationId: "private-operation", phase: "draining", startedAt: "2026-09-10T00:00:00Z", heartbeatAt: "2026-09-10T00:01:00Z", expiresAt: "2026-09-10T00:02:00Z" };

test("maintenance expiration marks stale without releasing the hold or exposing operator identity", function snapshots() {
  const current = parseBuildMaintenance(JSON.stringify(record), Date.parse("2026-09-10T00:01:30Z"));
  assert.equal(current?.stale, false);
  assert.equal(current?.phase, "draining");
  assert.ok(!JSON.stringify(current).includes("private-operation"));
  assert.equal(parseBuildMaintenance(record, Date.parse("2026-09-10T00:03:00Z"))?.stale, true);
  assert.equal(parseBuildMaintenance(record, Date.parse("2026-09-09T23:00:00Z"))?.stale, true);
  for (const malformed of ["", "not JSON", "null", "{}", [], { ...record, phase: "other" }, { ...record, heartbeatAt: "invalid" }]) {
    assert.equal(parseBuildMaintenance(malformed)?.stale, true);
  }
  assert.equal(parseBuildMaintenance(null), null);
  assert.equal(parseBuildMaintenance(undefined), null);
});

test("PostgreSQL maintenance holds new durable claims while an existing claim keeps its lease and progress", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function durable(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(connectionString).hostname), "Use an isolated loopback fixture");
  const admin = new Pool({ connectionString });
  const namespace = `maintenance_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${namespace},public` });
  t.after(async function cleanup() { await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await pool.query("create table builds(id text primary key,project_id text,user_id text,status text,error text,started_at timestamptz,trigger_run_id text)");
  await pool.query("create table app_settings(key text primary key,value text)");
  await pool.query(await readFile("drizzle/0054_build_worker.sql", "utf8"));
  const migration = await readFile("drizzle/0057_build_pricing.sql", "utf8");
  await pool.query(migration.slice(migration.indexOf("ALTER TABLE build_worker_jobs"), migration.indexOf("CREATE TABLE IF NOT EXISTS build_pricing_quotes")));
  for (const id of ["first", "second"]) {
    await pool.query("insert into builds values($1,$1,'owner','queued',null,null,null)", [id]);
    await enrollWorkerBuild(pool, id);
  }
  const first = await claimWorkerBuild(pool, "worker", 60_000);
  assert.ok(first);
  await pool.query("insert into app_settings values($1,$2)", [BUILD_MAINTENANCE_KEY, JSON.stringify(record)]);
  assert.equal((await readBuildMaintenance(pool))?.stale, true);
  assert.equal(await claimWorkerBuild(pool, "other-worker"), null);
  assert.equal((await heartbeatWorker(pool, first, 60_000)).stopRequested, false);
  assert.equal((await pool.query("select state from build_worker_jobs where build_id=$1", [first.buildId])).rows[0].state, "running");
  await pool.query("update app_settings set value='malformed' where key=$1", [BUILD_MAINTENANCE_KEY]);
  assert.equal(await claimWorkerBuild(pool, "other-worker"), null);
  await pool.query("delete from app_settings where key=$1", [BUILD_MAINTENANCE_KEY]);
  assert.equal(await readBuildMaintenance(pool), null);
  const second = await claimWorkerBuild(pool, "other-worker");
  assert.ok(second);
  assert.notEqual(second.buildId, first.buildId);
});
