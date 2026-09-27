import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import type { PublicClient } from "viem";
import type { ExplorerTokenPage } from "./authority/blockscout";

test("explorer scouting persists pages, verifies candidates separately and resumes errors without losing coverage", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function scouting(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `explorer_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace}`);
  const database = new Pool({ connectionString: url.toString() });
  process.env.DATABASE_URL = url.toString();
  const { scoutExplorerCatalog } = await import("./explorer-scouting");
  const { readExplorerCoverage } = await import("./explorer-coverage");
  const { close } = await import("@/lib/db");
  const address = `0x${"1".repeat(40)}`;
  const chainId = 4663;
  try {
    await admin.query(`create schema ${namespace}`);
    for (const table of ["robinhood_app_pairs", "dex_tokens", "registry_assets", "registry_token_observations", "app_settings", "rate_counters"]) {
      await database.query(`create table ${table} (like public.${table} including all)`);
    }
    await database.query(await readFile("drizzle/0060_explorer_scouting.sql", "utf8"));
    await database.query(`insert into robinhood_app_pairs(id,symbol,name,pair,first_observed_at,observed_at)
      values('fixture','TEST','Fixture','{}',now(),now())`);
    let verified = 0;
    const dependencies = { database, client: {} as PublicClient,
      async verify(_chainId: number, addresses: string[]): Promise<{ read: number; failed: number }> {
        assert.deepEqual(addresses, [address]);
        const before = (await database.query("select symbol,bytecode_present from dex_tokens where address=$1", [address])).rows[0];
        assert.equal(before.symbol, null, "Explorer-reported names never become RPC metadata");
        assert.equal(before.bytecode_present, null);
        verified++;
        await database.query(`insert into registry_token_observations(chain_id,address,metadata)
          values($1,$2,jsonb_build_object('reason',null,'asOf',now(),'bytecodePresent',true,'symbol','TEST'))`, [chainId, address]);
        return { read: 1, failed: 0 };
      },
    };
    const next = { q: "TEST", items_count: 50, contract_address_hash: address };
    await t.test("first page records provenance and leaves unfinished pagination due", async function first() {
      const result = await scoutExplorerCatalog(chainId, { ...dependencies, async search(symbol, cursor): Promise<ExplorerTokenPage> {
        assert.equal(symbol, "TEST"); assert.equal(cursor, null);
        return { items: [{ address, name: "Reported only", symbol: "TEST", decimals: 18, holders: 20, totalSupplyRaw: "100" },
          { address: `0x${"2".repeat(40)}`, name: "Unrelated", symbol: "TESTOTHER", decimals: 18, holders: 40, totalSupplyRaw: "200" }], next };
      } });
      assert.equal(result.error, undefined); assert.equal(verified, 1);
      assert.equal((await database.query("select count(*)::int n from dex_tokens")).rows[0].n, 1);
      const reading = await readExplorerCoverage(chainId, database);
      assert.equal(reading.searchesDue, 1); assert.equal(reading.searchesCompleted, 0); assert.equal(reading.pendingContractChecks, 0);
    });
    await t.test("failure retains cursor and earlier candidates with a cooldown", async function failure() {
      const result = await scoutExplorerCatalog(chainId, { ...dependencies, async search(_symbol, cursor) {
        assert.deepEqual(cursor, next); throw new Error("Fixture schema change");
      } });
      assert.match(result.error!, /schema change/);
      const state = (await database.query("select next_page,error from registry_explorer_searches")).rows[0];
      assert.deepEqual(state.next_page, next);
      assert.match(state.error, /schema change/);
      await scoutExplorerCatalog(chainId, { ...dependencies, async search() { throw new Error("Cooldown must prevent a request"); } });
      assert.equal((await database.query("select error from registry_explorer_searches")).rows[0].error, "Fixture schema change");
    });
    await t.test("retry completes the same scan and a catalog change reopens it", async function retry() {
      await database.query("update registry_explorer_searches set attempted_at=now()-interval '6 minutes'");
      await scoutExplorerCatalog(chainId, { ...dependencies, async search(_symbol, cursor) {
        assert.deepEqual(cursor, next); return { items: [], next: null };
      } });
      assert.equal((await readExplorerCoverage(chainId, database)).searchesCompleted, 1);
      await database.query("update robinhood_app_pairs set observed_at=clock_timestamp()");
      assert.equal((await readExplorerCoverage(chainId, database)).searchesDue, 1);
      await scoutExplorerCatalog(chainId, { ...dependencies, async search(_symbol, cursor) {
        assert.equal(cursor, null); return { items: [], next: null };
      } });
      assert.equal(verified, 1, "Fresh verified candidates do not repeat RPC reads");
    });
    await t.test("another generation cannot run the same scout", async function exclusion() {
      const owner = await database.connect();
      try {
        await owner.query("select pg_advisory_lock($1,6060)", [chainId]);
        const result = await scoutExplorerCatalog(chainId, { ...dependencies, async search() { throw new Error("No request allowed"); } });
        assert.equal(result.detail?.skipped, "another_scout_is_running");
      } finally { await owner.query("select pg_advisory_unlock($1,6060)", [chainId]); owner.release(); }
    });
    await t.test("provider accounting bounds attempts and public status omits the credit balance", async function accounting() {
      const { explorerAccounting, EXPLORER_REQUESTS_PER_DAY } = await import("./explorer-provider");
      await explorerAccounting.beforeRequest();
      await explorerAccounting.afterResponse(new Response("{}", { headers: { "x-credits-remaining": "99999980", "x-ratelimit-limit": "15" } }));
      const provider = (await readExplorerCoverage(chainId, database)).provider!;
      assert.equal(provider.creditsAvailable, true); assert.equal(provider.requestsPerSecond, 15);
      assert.equal("creditsRemaining" in provider, false);
      await database.query("update rate_counters set count=$1 where bucket='blockscout:day'", [EXPLORER_REQUESTS_PER_DAY]);
      await assert.rejects(explorerAccounting.beforeRequest(), /daily request allowance/);
    });
  } finally {
    await close(); await database.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end();
  }
});
