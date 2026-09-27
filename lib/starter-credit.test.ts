import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import { ensureStarterCredit, STARTER_CREDIT_SETTING } from "./starter-credit";
import { reserveDailyBuild, BuildDailyLimitError } from "./ratelimit";

const connectionString = process.env.FLETCH_TEST_DATABASE_URL;

test("starter claims survive account removal, concurrent requests and transaction failure", { skip: !connectionString }, async function starter(t): Promise<void> {
  const admin = new Pool({ connectionString });
  const namespace = `starter_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  t.after(async function cleanup(): Promise<void> { await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await pool.query(`create table "user"(id text primary key,created_at timestamp not null default now());
    create table wallet_address(id text,user_id text references "user" on delete cascade,address text,created_at timestamp default now());
    create table app_settings(key text primary key,value text);
    create table starter_credit_claims(address text primary key,user_id text references "user" on delete set null,claimed_at timestamptz default now());
    create table credit_events(id text primary key,user_id text,delta integer check(delta > 0),reason text,idempotency_key text unique,external_ref text);
    create table rate_counters(bucket text primary key,count integer,window_start timestamptz);`);
  await pool.query('insert into "user" values(\'new\',now()),(\'old\',\'2020-01-01\'),(\'no-wallet\',now()),(\'other-chain\',now()),(\'rollback\',now())');
  const address = `0x${"a".repeat(40)}`;
  const second = `0x${"b".repeat(40)}`;
  await pool.query("insert into wallet_address(id,user_id,address) values('1','new',$1),('2','other-chain',$2),('3','rollback',$3)", [address, address.toUpperCase().replace("0X", "0x"), second]);
  assert.equal(await ensureStarterCredit("new", database), "disabled");
  await pool.query("insert into app_settings values($1,'2026-01-01T00:00:00Z')", [STARTER_CREDIT_SETTING]);
  assert.equal(await ensureStarterCredit("old", database), "not-new");
  assert.equal(await ensureStarterCredit("no-wallet", database), "no-wallet");
  const outcomes = await Promise.all(Array.from({ length: 12 }, () => ensureStarterCredit("new", database)));
  assert.equal(outcomes.filter(value => value === "granted").length, 1);
  assert.equal((await pool.query("select sum(delta) as balance from credit_events where user_id='new'")).rows[0].balance, '1');
  assert.equal(await ensureStarterCredit("other-chain", database), "already");
  await pool.query('delete from "user" where id=\'new\'');
  assert.equal((await pool.query("select user_id from starter_credit_claims where address=$1", [address])).rows[0].user_id, null);
  assert.equal(await ensureStarterCredit("other-chain", database), "already");
  await pool.query("alter table credit_events add constraint reject_fixture check(user_id <> 'rollback')");
  await assert.rejects(ensureStarterCredit("rollback", database), error => error instanceof Error && error.cause instanceof Error && error.cause.message.includes("reject_fixture"));
  assert.equal((await pool.query("select 1 from starter_credit_claims where address=$1", [second])).rowCount, 0);
  await pool.query("alter table credit_events drop constraint reject_fixture");
  assert.equal(await ensureStarterCredit("rollback", database), "granted");

  // The daily budget shares the build transaction and cannot be exhausted by
  // requests whose account, balance or build inserts are rejected.
  await assert.rejects(database.transaction(async function refused(tx): Promise<void> {
    await reserveDailyBuild(statement => tx.execute(statement));
    throw new Error("controlled failed build insert");
  }), /controlled failed/);
  assert.equal((await pool.query("select 1 from rate_counters")).rowCount, 0);
  const limit = Number(process.env.FORGE_BUILDS_GLOBAL_DAY ?? 500);
  await pool.query("insert into rate_counters values('global:day',$1,now())", [limit - 1]);
  const admissions = await Promise.allSettled(Array.from({ length: 8 }, () => database.transaction(tx => reserveDailyBuild(statement => tx.execute(statement)))));
  assert.equal(admissions.filter(value => value.status === "fulfilled").length, 1);
  assert.ok(admissions.filter(value => value.status === "rejected").every(value => value.status === "rejected" && value.reason instanceof BuildDailyLimitError));
  assert.equal((await pool.query("select count from rate_counters")).rows[0].count, limit);
});
