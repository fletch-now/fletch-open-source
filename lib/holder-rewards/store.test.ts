import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/lib/db/schema";
import { EMPTY_HOLDER_POLICY, HOLDER_POLICY_KEY, type HolderEvidence, type HolderPolicy } from "./model";
import { checkHolderReward } from "./store";
import { saveHolderPolicy } from "./admin";

const connectionString = process.env.FLETCH_TEST_DATABASE_URL;

test("holder credits are atomic and remain deduplicated across retries, accounts and policy changes", { skip: !connectionString }, async t => {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(connectionString!).hostname), "Use an isolated local PostgreSQL database.");
  const admin = new Pool({ connectionString });
  const namespace = `holder_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, max: 16, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  t.after(async () => { await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await pool.query(`create type credit_reason as enum('free_grant');
    create table "user"(id text primary key,banned boolean default false);
    create table wallet_address(id text primary key,user_id text references "user" on delete cascade,address text,chain_id integer,is_primary boolean default true,created_at timestamp default now());
    create table app_settings(key text primary key,value text,updated_by text,updated_at timestamp default now());
    create table credit_events(id text primary key,user_id text references "user" on delete cascade,delta integer,reason credit_reason,idempotency_key text unique,external_ref text);
    create table rate_counters(bucket text primary key,count integer,window_start timestamptz);
    create table audit_log(id text primary key,user_id text,actor_type text,action text,resource_type text,resource_id text,metadata jsonb);`);
  // Exercise the actual additive migration, including replay compatibility.
  const migration = await readFile("drizzle/0071_holder_credits.sql", "utf8");
  await pool.query(migration);
  await pool.query(migration);
  let policy: HolderPolicy = { ...EMPTY_HOLDER_POLICY, enabled: true, chainId: 4663, tokenAddress: `0x${"f".repeat(40)}`, referencePoolId: "pool", period: "once", immediateGrantAccepted: true };
  async function save(patch: Partial<HolderPolicy> = {}): Promise<void> {
    policy = { ...policy, ...patch, revision: policy.revision + 1 };
    await pool.query("insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value", [HOLDER_POLICY_KEY, JSON.stringify(policy)]);
  }
  let addressSequence = 0;
  async function user(id: string, address = `0x${(++addressSequence).toString(16).padStart(40, "0")}`, chain = 4663): Promise<string> {
    await pool.query('insert into "user"(id) values($1)', [id]);
    await pool.query("insert into wallet_address(id,user_id,address,chain_id) values($1,$1,$2,$3)", [id, address, chain]);
    return address.toLowerCase();
  }
  function evidence(p: HolderPolicy, address: string, patch: Partial<HolderEvidence> = {}): HolderEvidence {
    return { address, chainId: 4663, tokenAddress: p.tokenAddress!, balanceRaw: "101000000", decimals: 6, priceUsd: "1", poolId: "pool", depthUsd: "25000",
      priceAt: new Date(Date.now() - 1000).toISOString(), checkedAt: new Date().toISOString(), safeBlock: "10", safeBlockHash: `0x${"a".repeat(64)}`, latestBlock: "11", ...patch };
  }
  const observe = async (p: HolderPolicy, wallet: string) => evidence(p, wallet);
  async function retry(id: string): Promise<void> { await pool.query("update holder_credit_checks set next_check_at=now()-interval '1 minute' where user_id=$1", [id]); }
  async function claims(id: string): Promise<number> { return (await pool.query("select * from holder_credit_claims where user_id=$1", [id])).rowCount!; }

  await t.test("disabled is inert; twelve simultaneous checks produce exactly one ten-credit grant", async () => {
    const address = await user("alice", `0x${"AB".repeat(20)}`);
    let observed = 0;
    const controlled = async (p: HolderPolicy, wallet: string) => { observed++; assert.equal(wallet, address); return observe(p, wallet); };
    assert.equal((await checkHolderReward("alice", database, controlled)).state, "not_open");
    assert.equal(observed, 0);
    await save();
    const outcomes = await Promise.all(Array.from({ length: 12 }, () => checkHolderReward("alice", database, controlled)));
    assert.equal(outcomes.filter(value => value.state === "granted").length, 1);
    assert.equal(observed, 1);
    assert.equal(await claims("alice"), 1);
    assert.equal((await pool.query("select sum(delta) as balance from credit_events where user_id='alice'")).rows[0].balance, "10");
    assert.equal((await pool.query("select * from audit_log where action='credits.holder_grant'")).rowCount, 1);
  });

  await t.test("one address cannot claim again after account deletion; one account cannot switch wallets for another grant", async () => {
    const wallet = (await pool.query("select address from holder_credit_claims where user_id='alice'")).rows[0].address;
    await pool.query("update wallet_address set address=$1 where user_id='alice'", [`0x${"c".repeat(40)}`]);
    assert.equal((await checkHolderReward("alice", database, observe)).state, "already_granted");
    await pool.query('delete from "user" where id=\'alice\'');
    await user("replacement", wallet);
    assert.equal((await checkHolderReward("replacement", database, observe)).state, "already_granted");
    assert.equal(await claims("replacement"), 0);
  });

  await t.test("wrong-network and banned wallets never reach the balance reader", async () => {
    await user("testnet", undefined, 46630);
    await user("banned");
    await pool.query('update "user" set banned=true where id=\'banned\'');
    const refuse = async (): Promise<HolderEvidence> => { throw new Error("This reader must not be called"); };
    for (const id of ["testnet", "banned", "missing-user"]) assert.equal((await checkHolderReward(id, database, refuse)).state, "verify_wallet");
  });

  await t.test("a failed ledger or audit write rolls back the entire grant and remains retryable", async () => {
    for (const table of ["credit_events", "audit_log"]) {
      const id = `rollback-${table}`;
      await user(id);
      await pool.query(`alter table ${table} add constraint controlled_failure check(user_id <> '${id}')`);
      assert.equal((await checkHolderReward(id, database, observe)).state, "unavailable");
      assert.equal(await claims(id), 0);
      assert.equal((await pool.query("select * from credit_events where user_id=$1", [id])).rowCount, 0);
      await pool.query(`alter table ${table} drop constraint controlled_failure`);
      await retry(id);
      assert.equal((await checkHolderReward(id, database, observe)).state, "granted");
      assert.equal(await claims(id), 1);
    }
  });

  await t.test("bad or expired evidence cannot award credits", async () => {
    const id = "evidence";
    await user(id);
    for (const patch of [{ priceAt: "invalid" }, { priceAt: new Date(Date.now() - 130_000).toISOString() }, { checkedAt: new Date(Date.now() - 40_000).toISOString() }, { checkedAt: "invalid" }, { address: `0x${"e".repeat(40)}` }, { tokenAddress: `0x${"e".repeat(40)}` }, { chainId: 1 }, { poolId: "wrong" }]) {
      await retry(id);
      const outcome = await checkHolderReward(id, database, async (p, wallet) => evidence(p, wallet, patch));
      assert.equal(outcome.state, "unavailable");
      assert.equal(await claims(id), 0);
    }
    await retry(id);
    assert.equal((await checkHolderReward(id, database, async (p, wallet) => evidence(p, wallet, { balanceRaw: "100000000" }))).state, "below_threshold");
  });

  await t.test("pause, policy revision, wallet changes and expired leases fence in-flight grants", async () => {
    for (const fault of ["pause", "revision", "wallet", "lease"]) {
      const id = `fenced-${fault}`;
      await user(id);
      await save({ enabled: true });
      const outcome = await checkHolderReward(id, database, async (p, wallet) => {
        if (fault === "pause") await save({ enabled: false });
        if (fault === "revision") await save();
        if (fault === "wallet") await pool.query("update wallet_address set address=$1 where user_id=$2", [`0x${"d".repeat(40)}`, id]);
        if (fault === "lease") await retry(id);
        return evidence(p, wallet);
      });
      assert.equal(outcome.state, "unavailable");
      assert.equal(await claims(id), 0);
    }
  });

  await t.test("global RPC and daily grant ceilings cannot be bypassed with parallel accounts", async () => {
    await save({ enabled: true, maxGrantsPerDay: 4 }); // Three claims already exist, including the deleted account.
    await Promise.all(["limit-a", "limit-b", "limit-c"].map(id => user(id)));
    const outcomes = await Promise.all(["limit-a", "limit-b", "limit-c"].map(id => checkHolderReward(id, database, observe)));
    assert.equal(outcomes.filter(value => value.state === "granted").length, 1);
    assert.equal(outcomes.filter(value => value.state === "daily_limit").length, 2);
    await user("rpc-limit");
    await pool.query("update rate_counters set count=120,window_start=now() where bucket='fltx:checks:minute'");
    let reads = 0;
    assert.equal((await checkHolderReward("rpc-limit", database, async (p, wallet) => { reads++; return observe(p, wallet); })).state, "unavailable");
    assert.equal(reads, 0);
  });

  await t.test("operator activation verifies live evidence; stale edits and campaign identity changes are refused", async () => {
    const enabled = await saveHolderPolicy(policy, policy.revision, null, database, observe);
    assert.ok(enabled.activatedAt);
    assert.equal(enabled.revision, policy.revision + 1);
    await assert.rejects(saveHolderPolicy(policy, policy.revision, null, database, observe), /another session/);
    await assert.rejects(saveHolderPolicy({ ...enabled, period: "utc_day" }, enabled.revision, null, database, observe), /activated campaign/);
    await assert.rejects(saveHolderPolicy({ ...enabled, immediateGrantAccepted: false }, enabled.revision, null, database, observe), /holding-period/);
    const noRpc = async (): Promise<HolderEvidence> => { throw new Error("controlled unavailable RPC"); };
    await assert.rejects(saveHolderPolicy(enabled, enabled.revision, null, database, noRpc), /live verification/);
    const paused = await saveHolderPolicy({ ...enabled, enabled: false }, enabled.revision, null, database, noRpc);
    assert.equal(paused.enabled, false);
    assert.equal(paused.activatedAt, enabled.activatedAt);
  });
});
