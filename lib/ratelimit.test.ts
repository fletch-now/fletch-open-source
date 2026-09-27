import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

const connectionString = process.env.FLETCH_TEST_DATABASE_URL;

test("enhancement budgets bound wallet rotation and concurrent requests", { skip: !connectionString }, async function enhancement(t): Promise<void> {
  const admin = new Pool({ connectionString });
  const namespace = `enhance_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  await admin.query(`create table ${namespace}.rate_counters(bucket text primary key,count integer,window_start timestamptz)`);
  const url = new URL(connectionString!);
  url.searchParams.set("options", `-c search_path=${namespace}`);
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = url.toString();
  const { pool } = await import("./db");
  const { checkEnhanceRate } = await import("./ratelimit");
  t.after(async function cleanup(): Promise<void> {
    await pool.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });

  assert.equal((await checkEnhanceRate("missing-address", "")).ok, false);
  assert.equal((await pool.query("select count(*) from rate_counters")).rows[0].count, "0");
  const burst = await Promise.all(Array.from({ length: 50 }, (_, index) => checkEnhanceRate(`user-${index}`, `192.0.2.${index + 1}`)));
  assert.equal(burst.filter(result => result.ok).length, 10);
  assert.ok(burst.filter(result => !result.ok).every(result => (result.retryAfterSeconds ?? 0) > 0));
  assert.equal((await pool.query("select count from rate_counters where bucket='enhance:day'")).rows[0].count, 10);

  await pool.query("update rate_counters set window_start=now()-interval '2 minutes' where bucket='enhance:minute'");
  assert.equal((await checkEnhanceRate("after-reset", "192.0.2.100")).ok, true);
  await pool.query("truncate rate_counters");
  await pool.query("insert into rate_counters values('enhance:day',499,now())");
  const lastSlot = await Promise.all(Array.from({ length: 20 }, (_, index) => checkEnhanceRate(`last-${index}`, `198.51.100.${index + 1}`)));
  assert.equal(lastSlot.filter(result => result.ok).length, 1);

  for (const [bucket, count] of [["enhance:same-user", 30], ["enhance-ip:203.0.113.1", 60]] as const) {
    await pool.query("truncate rate_counters");
    await pool.query("insert into rate_counters values($1,$2,now())", [bucket, count]);
    const result = await checkEnhanceRate("same-user", "203.0.113.1");
    assert.equal(result.ok, false);
    assert.ok((result.retryAfterSeconds ?? 0) >= 3590);
    assert.equal((await pool.query("select count(*) from rate_counters where bucket='enhance:minute'")).rows[0].count, "0");
  }
  await pool.query("drop table rate_counters");
  assert.equal((await checkEnhanceRate("store-down", "192.0.2.200")).ok, false);
});
