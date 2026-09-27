import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import type { ExplorerCursor, ExplorerTokenPage } from "./blockscout";

function address(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

test("lookalike searches resume committed pages, retry fairly and bound local and beacon work", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function progress(t) {
  const previousDatabase = process.env.DATABASE_URL;
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `lookalike_progress_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace} -c timezone=UTC`);
  process.env.DATABASE_URL = url.toString();
  const { pool } = await import("@/lib/db");
  t.after(async function cleanup() {
    await pool.end();
    await admin.query(`drop schema if exists ${namespace} cascade`);
    await admin.end();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });
  await admin.query(`create schema ${namespace}`);
  for (const table of ["registry_assets", "dex_tokens", "lookalike_tokens", "sync_runs", "authority_events"]) {
    await admin.query(`create table ${namespace}.${table} (like public.${table} including all)`);
  }
  await admin.query(`set search_path to ${namespace}`);
  await admin.query(await readFile("drizzle/0061_lookalike_scan_progress.sql", "utf8"));
  const { scanLookalikes, getLookalikeCoverage, LOOKALIKE_SEARCH_BATCH, LOOKALIKE_LOCAL_BATCH, LOOKALIKE_BEACON_BATCH } = await import("./lookalikes");
  await pool.query(`insert into registry_assets
    (id,chain_id,address,symbol,name,asset_type,source,decimals,status,verified_at,onchain_symbol,onchain_decimals)
    select 'asset-'||i,4663,'0x'||lpad(to_hex(i),40,'0'),'S'||i,'Stock '||i,'stock_token','fixture',18,'active',now(),'S'||i,18
    from generate_series(1,10) i`);
  const observedAt = new Date("2026-09-01T00:00:00Z");
  await pool.query(`insert into dex_tokens(id,chain_id,address,symbol,name,decimals,bytecode_present,checked_at)
    select 'token-'||i,4663,'0x'||lpad(to_hex(i+100),40,'0'),'S1','Other name',18,true,$1
    from generate_series(1,$2) i`, [observedAt.toISOString(), LOOKALIKE_LOCAL_BATCH + 1]);
  const searches: { symbol: string; cursor: ExplorerCursor | null }[] = [];
  const beaconCalls: string[] = [];
  let fail = true;
  async function search(symbol: string, cursor: ExplorerCursor | null): Promise<ExplorerTokenPage> {
    searches.push({ symbol, cursor });
    if (symbol === "S1" && fail) throw new Error("fixture source unavailable");
    if (symbol === "S10" && !cursor) return { items: [], next: { items_count: 50 } };
    return { items: [], next: null };
  }
  async function beacon(_chainId: number, tokenAddress: string): Promise<null> {
    beaconCalls.push(tokenAddress);
    return null;
  }
  const first = await scanLookalikes(4663, { search, beacon });
  assert.equal(searches.length, LOOKALIKE_SEARCH_BATCH);
  assert.equal(first.detail?.localScanned, LOOKALIKE_LOCAL_BATCH);
  assert.equal(first.detail?.localComplete, false);
  assert.equal(first.detail?.localAdded, LOOKALIKE_LOCAL_BATCH);
  assert.match(first.error ?? "", /fixture source unavailable/);
  assert.equal(beaconCalls.length, 0, "source denial cannot trigger unrelated enrichment reads");
  let coverage = await getLookalikeCoverage(4663);
  assert.equal(coverage.failed, 1);
  assert.equal(coverage.completed, 6);
  assert.equal(coverage.pending, 4);
  assert.equal(coverage.localCompletedAt, null);
  const before = await pool.query("select last_seen_at at time zone 'UTC' last_seen_at from lookalike_tokens where address=$1", [address(101)]);
  assert.equal(before.rows[0].last_seen_at.toISOString(), observedAt.toISOString());

  const second = await scanLookalikes(4663, { search, beacon });
  assert.equal(second.detail?.localScanned, 1, "local keyset survives between invocations");
  assert.equal(second.detail?.localComplete, true);
  assert.match(second.error ?? "", /awaiting successful retry/, "cooldown cannot erase source failure");
  assert.deepEqual(searches.slice(LOOKALIKE_SEARCH_BATCH).map((item) => item.symbol), ["S8", "S9", "S10"]);
  assert.deepEqual(searches.find((item) => item.symbol === "S10" && item.cursor)?.cursor, { items_count: 50 });
  assert.equal(beaconCalls.length, LOOKALIKE_BEACON_BATCH, "enrichment has an independent strict address bound");
  coverage = await getLookalikeCoverage(4663);
  assert.equal(coverage.pending, 1);
  assert.equal(coverage.completed, 9);
  assert.ok(coverage.localCompletedAt);

  fail = false;
  await pool.query("update registry_lookalike_searches set attempted_at=now()-interval '6 minutes' where asset_id='asset-1'");
  const recovered = await scanLookalikes(4663, { search, beacon });
  assert.equal(recovered.error, undefined);
  assert.equal(new Set(beaconCalls).size, beaconCalls.length, "successful null slots are cached durably, not re-read");
  coverage = await getLookalikeCoverage(4663);
  assert.equal(coverage.pending, 0);
  assert.equal(coverage.failed, 0);
  assert.equal(coverage.completed, 10);
  const after = await pool.query("select last_seen_at at time zone 'UTC' last_seen_at from lookalike_tokens where address=$1", [address(101)]);
  assert.equal(after.rows[0].last_seen_at.toISOString(), observedAt.toISOString(), "local scans and beacon enrichment do not freshen explorer metadata");

  await t.test("a failed later page keeps the committed cursor and observation", async function pageFailure() {
    await pool.query("update registry_lookalike_searches set completed_at=now()-interval '7 hours' where asset_id='asset-10'");
    await scanLookalikes(4663, { search, beacon });
    const recorded = await pool.query("select observed_at,next_page from registry_lookalike_searches where asset_id='asset-10'");
    assert.deepEqual(recorded.rows[0].next_page, { items_count: 50 });
    const partial = await scanLookalikes(4663, { search: async function unavailable() { throw new Error("page 2 failed"); }, beacon });
    assert.match(partial.error ?? "", /page 2 failed/);
    const retained = await pool.query("select observed_at,next_page from registry_lookalike_searches where asset_id='asset-10'");
    assert.deepEqual(retained.rows[0], recorded.rows[0]);
  });

  await t.test("candidate rows, announcements and pagination commit together", async function pageTransaction() {
    await pool.query("update registry_lookalike_searches set attempted_at=now()-interval '6 minutes' where asset_id='asset-10'");
    await pool.query(`create function reject_fixture_candidate() returns trigger language plpgsql as $$
      begin if new.address='${address(9002)}' then raise exception 'fixture interrupted page'; end if; return new; end $$`);
    await pool.query("create trigger reject_fixture before insert on lookalike_tokens for each row execute function reject_fixture_candidate()");
    async function populatedPage(): Promise<ExplorerTokenPage> {
      return { items: [9001, 9002].map((id) => ({ address: address(id), symbol: "S10", name: "Stock 10",
        decimals: 18, holders: 70, totalSupplyRaw: "1000" })), next: null };
    }
    const interrupted = await scanLookalikes(4663, { search: populatedPage, beacon });
    assert.match(interrupted.error ?? "", /fixture interrupted page/);
    assert.equal((await pool.query("select count(*)::integer count from lookalike_tokens where address=any($1::text[])", [[address(9001), address(9002)]])).rows[0].count, 0);
    assert.equal((await pool.query("select count(*)::integer count from authority_events")).rows[0].count, 0);
    assert.deepEqual((await pool.query("select next_page from registry_lookalike_searches where asset_id='asset-10'")).rows[0].next_page, { items_count: 50 });
    await pool.query("drop trigger reject_fixture on lookalike_tokens");
    await pool.query("update registry_lookalike_searches set attempted_at=now()-interval '6 minutes' where asset_id='asset-10'");
    const retried = await scanLookalikes(4663, { search: populatedPage, beacon });
    assert.equal(retried.error, undefined);
    assert.equal(retried.detail?.added, 2);
    assert.equal(retried.detail?.announced, 2);
    assert.equal((await pool.query("select count(*)::integer count from authority_events")).rows[0].count, 2);
    assert.equal((await getLookalikeCoverage(4663)).pending, 0);
  });

  await t.test("failed beacon receipts retry without freshening token observations", async function beaconRetry() {
    await pool.query(`insert into registry_lookalike_beacons(chain_id,address,checked_at)
      select chain_id,address,now() from lookalike_tokens on conflict(chain_id,address) do update set checked_at=now(),error=null`);
    await pool.query("update registry_lookalike_beacons set checked_at=null,attempted_at=null where address=$1", [address(101)]);
    let reads = 0;
    const failed = await scanLookalikes(4663, { search, beacon: async function denied() { reads++; throw new Error("fixture RPC denied"); } });
    assert.match(failed.error ?? "", /1 beacon reads failed/);
    assert.equal(reads, 1);
    assert.equal((await getLookalikeCoverage(4663)).beaconFailed, 1);
    const cooldown = await scanLookalikes(4663, { search, beacon });
    assert.match(cooldown.error ?? "", /1 beacon reads awaiting successful retry/);
    assert.equal(cooldown.detail?.beaconReads, 0);
    await pool.query("update registry_lookalike_beacons set attempted_at=now()-interval '16 minutes' where address=$1", [address(101)]);
    const recovered = await scanLookalikes(4663, { search, beacon });
    assert.equal(recovered.error, undefined);
    assert.equal((await getLookalikeCoverage(4663)).beaconFailed, 0);
    const saved = await pool.query("select last_seen_at at time zone 'UTC' last_seen_at from lookalike_tokens where address=$1", [address(101)]);
    assert.equal(saved.rows[0].last_seen_at.toISOString(), observedAt.toISOString());
  });

  await t.test("overdue beacon retries recover while new candidates keep advancing", async function beaconRetryLane() {
    const total = LOOKALIKE_BEACON_BATCH * 3;
    await pool.query(`insert into lookalike_tokens
      (id,chain_id,address,symbol,name,matches_asset_id,matches_symbol,kind,first_seen_at,last_seen_at)
      select 'beacon-lane-'||i,4663,'0x'||lpad(to_hex(i+20000),40,'0'),'S1','Stock 1','asset-1','S1','unverified',$1,$1
      from generate_series(1,$2) i`, [observedAt.toISOString(), total]);
    await pool.query(`insert into registry_lookalike_beacons(chain_id,address,attempted_at,error)
      select 4663,'0x'||lpad(to_hex(i+20000),40,'0'),now()-interval '1 hour'+i*interval '1 second','old budget failure'
      from generate_series(1,3) i`);
    const attempted: string[] = [];
    let unavailable = true;
    async function retryBeacon(_chainId: number, tokenAddress: string): Promise<null> {
      attempted.push(tokenAddress);
      if (tokenAddress === address(20001) && unavailable) throw new Error("fixture RPC unavailable");
      return null;
    }
    const first = await scanLookalikes(4663, { search, beacon: retryBeacon });
    const retryAddresses = new Set<string>([address(20001), address(20002), address(20003)]);
    assert.equal(attempted.length, LOOKALIKE_BEACON_BATCH);
    assert.deepEqual(attempted.slice(0, 2), [address(20001), address(20002)], "old failures cannot wait behind the unread backlog");
    assert.ok(attempted.slice(2).every((item) => !retryAddresses.has(item)), "six fresh slots remain available");
    assert.equal(first.detail?.beaconRetryReads, 2);
    assert.equal(first.detail?.beaconReadsFailed, 1);
    assert.equal((await getLookalikeCoverage(4663)).beaconFailed, 2);
    assert.equal((await getLookalikeCoverage(4663)).beaconPending, total - 7);

    attempted.length = 0;
    const second = await scanLookalikes(4663, { search, beacon: retryBeacon });
    assert.equal(attempted.length, LOOKALIKE_BEACON_BATCH);
    assert.equal(attempted[0], address(20003), "the next overdue retry advances on the following pass");
    assert.ok(!attempted.includes(address(20001)), "a failed retry retains its fifteen-minute cooldown");
    assert.ok(!attempted.includes(address(20002)), "a recovered null slot is not read again");
    assert.equal(second.detail?.beaconRetryReads, 1);
    assert.equal((await getLookalikeCoverage(4663)).beaconFailed, 1);
    assert.equal((await getLookalikeCoverage(4663)).beaconPending, total - 15);
    assert.match(second.error ?? "", /awaiting successful retry/, "fresh successes cannot erase an unresolved source failure");

    unavailable = false;
    attempted.length = 0;
    await pool.query("update registry_lookalike_beacons set attempted_at=now()-interval '16 minutes' where address=$1", [address(20001)]);
    const recovered = await scanLookalikes(4663, { search, beacon: retryBeacon });
    assert.equal(attempted[0], address(20001));
    assert.equal(recovered.error, undefined);
    assert.equal((await getLookalikeCoverage(4663)).beaconFailed, 0);
    assert.equal((await getLookalikeCoverage(4663)).beaconPending, total - 23);
    const saved = await pool.query("select last_seen_at at time zone 'UTC' last_seen_at from lookalike_tokens where address=$1", [address(20001)]);
    assert.equal(saved.rows[0].last_seen_at.toISOString(), observedAt.toISOString());
  });

  await t.test("overdue failures and untouched assets cannot starve each other", async function retryLane() {
    await pool.query(`insert into registry_assets
      (id,chain_id,address,symbol,name,asset_type,source,decimals,status,verified_at,onchain_symbol,onchain_decimals)
      select 'asset-'||i,4663,'0x'||lpad(to_hex(i),40,'0'),'S'||i,'Stock '||i,'stock_token','fixture',18,'active',now(),'S'||i,18
      from generate_series(11,50) i`);
    await pool.query(`update registry_lookalike_searches set completed_at=null,
      error='fixture retry failure',attempted_at=now()-interval '10 minutes'`);
    let recover = false;
    const attempted: string[] = [];
    async function retrySearch(symbol: string): Promise<ExplorerTokenPage> {
      attempted.push(symbol);
      if (Number(symbol.slice(1)) <= 10 && !recover) throw new Error("fixture retry failure");
      return { items: [], next: null };
    }
    const first = await scanLookalikes(4663, { search: retrySearch, beacon });
    assert.equal(attempted.length, LOOKALIKE_SEARCH_BATCH);
    assert.equal(attempted[0], "S1", "a due retry wins its slot despite forty untouched assets");
    assert.equal(first.detail?.searchesFailed, 1);
    assert.equal(first.detail?.pages, 7, "repeated failures retain seven fresh-search slots");
    assert.ok(attempted.slice(1).every((symbol) => Number(symbol.slice(1)) > 10));
    attempted.length = 0;
    const second = await scanLookalikes(4663, { search: retrySearch, beacon });
    assert.equal(attempted.length, LOOKALIKE_SEARCH_BATCH);
    assert.equal(attempted[0], "S10", "the retry lane rotates to the next overdue failure");
    assert.ok(!attempted.includes("S1"), "the five-minute retry cooldown still applies");
    assert.equal(second.detail?.searchesFailed, 1);
    assert.equal(second.detail?.pages, 7);
    await pool.query("update registry_lookalike_searches set attempted_at=now()-interval '11 minutes' where asset_id='asset-1'");
    recover = true;
    attempted.length = 0;
    const recovered = await scanLookalikes(4663, { search: retrySearch, beacon });
    assert.equal(attempted.length, LOOKALIKE_SEARCH_BATCH);
    assert.equal(attempted[0], "S1");
    assert.equal(recovered.detail?.pages, 8);
    assert.equal((await pool.query("select error from registry_lookalike_searches where asset_id='asset-1'")).rows[0].error, null);
    assert.match(recovered.error ?? "", /awaiting successful retry/, "other failed sources remain visibly incomplete");
  });

  await t.test("competing workers do not consume the same cursor", async function ownership() {
    const owner = await pool.connect();
    await owner.query("select pg_advisory_lock(4663,hashtext(current_schema()||':lookalikes'))");
    try {
      const result = await scanLookalikes(4663, { search, beacon });
      assert.equal(result.detail?.skipped, "another_lookalike_scan_is_running");
    } finally {
      await owner.query("select pg_advisory_unlock(4663,hashtext(current_schema()||':lookalikes'))");
      owner.release();
    }
  });
});
