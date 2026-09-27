import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

function address(n: number): `0x${string}` {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

test("beacon mimics remain lookalikes and explorer denial preserves independent local checks", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function identity(t) {
  const previousDatabase = process.env.DATABASE_URL;
  const previousRpc = process.env.RPC_URL_4663;
  const previousTimezone = process.env.TZ;
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `lookalikes_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace} -c timezone=UTC`);
  process.env.DATABASE_URL = url.toString();
  process.env.RPC_URL_4663 = "http://127.0.0.1:1";
  process.env.TZ = "UTC";
  const { db, pool } = await import("@/lib/db");
  const { lookalikeTokens } = await import("@/lib/db/schema");
  t.after(async function cleanup() {
    try {
      await pool.end();
      await admin.query(`drop schema if exists ${namespace} cascade`);
    } finally {
      await admin.end();
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousRpc === undefined) delete process.env.RPC_URL_4663;
      else process.env.RPC_URL_4663 = previousRpc;
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
  await admin.query(`create schema ${namespace}`);
  for (const table of ["registry_assets", "dex_tokens", "lookalike_tokens", "sync_runs", "authority_events"]) {
    await admin.query(`create table ${namespace}.${table} (like public.${table} including all)`);
  }
  await admin.query(`set search_path to ${namespace}`);
  await admin.query(await readFile("drizzle/0061_lookalike_scan_progress.sql", "utf8"));
  const { scanLookalikes: scan } = await import("./lookalikes");
  let beaconCalls = 0;
  async function scanLookalikes(chainId: number) {
    return scan(chainId, { beacon: async function beacon() {
      beaconCalls++;
      return ACCESS_CONTROLS_REGISTRY.toLowerCase();
    } });
  }
  const { lookalikes, lookalikesFor, lookalikesPage, lookalikeTotals } = await import("./read");
  const { trustForToken, trustForTokens } = await import("../trust");
  const { ACCESS_CONTROLS_REGISTRY } = await import("./constants");
  const { recordRun } = await import("./runs");
  const observedAt = new Date("2026-09-01T00:00:00Z");
  await pool.query(`insert into registry_assets
    (id,chain_id,address,symbol,name,asset_type,source,decimals,status,verified_at,onchain_symbol,onchain_decimals)
    values('tsla',4663,$1,'TSLA','Tesla','stock_token','fixture',18,'active',now(),'TSLA',18),
    ('wbtc',4663,$2,'WBTC','Wrapped Bitcoin','bridged','fixture',8,'active',now(),'WBTC',8)`, [address(1), address(2)]);
  await pool.query(`insert into lookalike_tokens
    (id,chain_id,address,matches_asset_id,matches_symbol,kind,beacon,holders,first_seen_at,last_seen_at)
    values($1,4663,$2,'tsla','TSLA','unlisted_stock',$3,123,$4,$4)`,
  [`4663:${address(3)}`, address(3), ACCESS_CONTROLS_REGISTRY.toLowerCase(), observedAt]);

  assert.equal((await trustForToken(4663, address(3))).level, "lookalike", "an unread historical beacon mimic has no identity exemption");
  assert.equal((await trustForTokens(4663, [address(3)])).get(address(3))?.level, "lookalike");
  assert.equal((await lookalikes(4663))[0].kind, "unverified");
  assert.equal((await lookalikesFor("tsla"))[0].kind, "unverified");
  assert.equal((await lookalikesPage(4663, { kind: "unverified", limit: 25, offset: 0 })).total, 1);
  assert.equal((await lookalikeTotals(4663)).unlistedStock, 0);

  await pool.query(`insert into dex_tokens(id,chain_id,address,symbol,name,decimals,bytecode_present,checked_at)
    values('folded-symbol',4663,$1,'ТSLA','Other name',18,true,$3),
    ('folded-name',4663,$2,'OTHER','Tеsla',18,true,$3)`, [address(4), address(5), observedAt]);
  let denied = true;
  let explorerCalls = 0;
  t.mock.method(globalThis, "fetch", async function explorer(input: string | URL | Request) {
    assert.match(String(input), /^https:\/\/(api\.blockscout\.com\/4663|robinhoodchain\.blockscout\.com)\/api\/v2\/tokens\?/);
    explorerCalls += 1;
    if (denied) return new Response(null, { status: 402 });
    if (String(input).includes("q=WBTC")) return Response.json({ items: [], next_page_params: null });
    return Response.json({ items: [
      { address_hash: address(6), symbol: "TSLA", name: "Tesla", decimals: "18", holders_count: "3" },
      { address_hash: address(1), symbol: "TSLA", name: "Tesla", decimals: "18" },
    ], next_page_params: null });
  });
  const partial = await scanLookalikes(4663);
  assert.match(partial.error ?? "", /HTTP 402/);
  assert.equal(partial.detail?.localComplete, true);
  assert.equal(partial.detail?.localCandidates, 2);
  assert.equal(partial.detail?.localAdded, 2);
  assert.equal(partial.detail?.searchesFailed, 1);
  assert.equal(explorerCalls, 1, "stop explorer attempts after access denial");
  assert.equal(beaconCalls, 0, "local checks need neither explorer nor beacon access");
  for (const local of [address(4), address(5)]) {
    assert.equal((await trustForToken(4663, local)).level, "lookalike");
    const saved = await pool.query("select last_seen_at from lookalike_tokens where address=$1", [local]);
    assert.equal(saved.rows[0].last_seen_at.toISOString(), observedAt.toISOString());
  }
  const inserts = t.mock.method(db, "insert");
  assert.equal(await recordRun("lookalikes", () => scanLookalikes(4663)), null);
  assert.equal(inserts.mock.calls.filter((call) => call.arguments[0] === lookalikeTokens).length, 0, "known collisions are counted without conflict-only writes");
  inserts.mock.restore();
  const run = await pool.query("select ok, error, detail from sync_runs order by started_at desc limit 1");
  assert.equal(run.rows[0].ok, false);
  assert.match(run.rows[0].error, /HTTP 402/);
  assert.equal(run.rows[0].detail.localComplete, true);
  assert.equal(run.rows[0].detail.localAdded, 0);
  const legacy = await pool.query("select kind,holders,beacon,last_seen_at from lookalike_tokens where address=$1", [address(3)]);
  assert.equal(legacy.rows[0].kind, "unlisted_stock", "reading current policy preserves historical evidence");
  assert.equal(legacy.rows[0].holders, 123);
  assert.equal(legacy.rows[0].last_seen_at.toISOString(), observedAt.toISOString());

  denied = false;
  await pool.query("update registry_lookalike_searches set attempted_at=now()-interval '6 minutes'");
  const recovered = await scanLookalikes(4663);
  assert.equal(recovered.error, undefined);
  assert.equal(beaconCalls, 3);
  const mimic = (await lookalikes(4663)).find((row) => row.address === address(6));
  assert.equal(mimic?.beacon, ACCESS_CONTROLS_REGISTRY.toLowerCase());
  assert.equal(mimic?.kind, "unverified", "a copied beacon slot proves no issuer origin");
  assert.equal((await trustForToken(4663, address(6))).level, "lookalike");
  assert.equal((await trustForToken(4663, address(1))).level, "verified");
  await pool.query("update registry_assets set onchain_decimals=6 where id='tsla'");
  assert.equal((await trustForToken(4663, address(1))).level, "listed", "verified identity still requires matching metadata");
});
