import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

function address(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

test("priority nomination keeps named, listed and fair candidates within a database deadline", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function integration(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const namespace = `priority_candidates_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace} -c timezone=UTC`);
  const database = new Pool({ connectionString: url.toString(), max: 2 });
  process.env.DATABASE_URL = url.toString();
  const { readPriorityCandidates } = await import("./priority");
  const { close } = await import("@/lib/db");
  const connection = await database.connect();
  t.after(async function cleanup() {
    connection.release();
    await close();
    await database.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
  });
  for (const table of ["registry_assets", "registry_asset_state", "dex_tokens", "dex_pools", "registry_priority_pools", "robinhood_app_pairs"]) {
    await database.query(`create table ${table} (like public.${table} including all)`);
  }
  await database.query(`insert into registry_assets(id,chain_id,address,symbol,name,asset_type,source,decimals) values
    ('quote',4663,$1,'USDG','Dollar','stablecoin','fixture',18),
    ('stock',4663,$2,'STOCK','Listed Stock','stock_token','fixture',18)`, [address(1), address(2)]);
  await database.query(`insert into dex_tokens(id,chain_id,address,symbol,name,hidden) values
    ('named',4663,$1,'CASHCAT','Cash Cat',false),
    ('hidden',4663,$2,'CASHCAT','Hidden',true),
    ('other-chain',46630,$3,'CASHCAT','Other Chain',false)`, [address(100), address(101), address(102)]);

  async function addPool(n: number, token: string, input: { assetId?: string; tier?: string; block?: number; canonical?: boolean } = {}): Promise<void> {
    await database.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,
      token_address,asset_id,quote_asset_id,created_block,canonical,tier,state_attempted_at,depth_usd)
      values($1,4663,'uniswap_v3',$1,$2,$3,3000,60,$4,$2,$5,'quote',$6,$7,$8,now(),$9)`,
    [address(n), token, address(1), address(0), input.assetId ?? null, input.block ?? n,
      input.canonical ?? true, input.tier ?? "active", n]);
  }
  for (let n = 1000; n < 1170; n++) await addPool(n, address(n + 2000));
  for (let n = 2000; n < 2005; n++) await addPool(n, address(100), { tier: "quiet" });
  await addPool(3000, address(101));
  await addPool(3001, address(102), { tier: "quiet" });
  await addPool(3002, address(0));
  await addPool(3003, address(100), { canonical: false });
  await addPool(3004, address(999), { assetId: "stock", tier: "quiet" });
  await addPool(4000, address(4001), { block: 1 });
  await database.query("update dex_pools set state_attempted_at=null where id=$1", [address(4000)]);

  await connection.query("set statement_timeout='2s'");
  await t.test("quiet catalog names and canonical stock identities survive bounded pool ranking", async function membership() {
    const rows = await readPriorityCandidates(4663, connection);
    const ids = rows.map(function id(row) { return row.id; });
    assert.equal(ids.length, new Set(ids).size);
    assert.ok(ids.includes(address(2004)), "quiet catalog names remain candidates beyond the venue leaders");
    assert.ok(ids.includes(address(2001)));
    assert.ok(!ids.includes(address(2000)), "the named token keeps its four highest-depth candidates");
    assert.ok(ids.includes(address(4000)), "the oldest pool receives its fair discovery slot");
    assert.equal(rows.find(function stock(row) { return row.id === address(3004); })?.address, address(2));
    for (const n of [3000, 3001, 3002, 3003]) assert.ok(!ids.includes(address(n)));
    assert.equal((await connection.query("show statement_timeout")).rows[0].statement_timeout, "2s");
  });
  await t.test("a growing named catalog retains the global 1,200-pool admission bound", async function capacity() {
    await database.query(`insert into dex_tokens(id,chain_id,address,symbol,name)
      select 'catalog-'||n,4663,'0x'||lpad(to_hex(100000+n),40,'0'),'CASHCAT','Cash Cat '||n
      from generate_series(1,400) n`);
    await database.query(`insert into dex_pools(id,chain_id,venue,pool_address,currency0,currency1,fee,tick_spacing,hooks,
      token_address,quote_asset_id,created_block,tier,state_attempted_at,depth_usd)
      select '0x'||lpad(to_hex(10000+n*4+k),40,'0'),4663,'uniswap_v3','0x'||lpad(to_hex(10000+n*4+k),40,'0'),
        '0x'||lpad(to_hex(100000+n),40,'0'),$1,3000,60,$2,'0x'||lpad(to_hex(100000+n),40,'0'),
        'quote',10000+n*4+k,'quiet',now(),k
      from generate_series(1,400) n cross join generate_series(0,3) k`, [address(1), address(0)]);
    const rows = await readPriorityCandidates(4663, connection);
    assert.equal(rows.length, 1200);
    assert.equal(new Set(rows.map(function id(row) { return row.id; })).size, 1200);
  });
  await t.test("the server cancels a blocked nomination and restores the connection for retry", async function deadline() {
    const blocker = await database.connect();
    try {
      await blocker.query("begin");
      await blocker.query("lock table dex_tokens in access exclusive mode");
      const startedAt = Date.now();
      await assert.rejects(readPriorityCandidates(4663, connection), function timedOut(error: unknown) {
        return (error as { code?: string }).code === "57014";
      });
      assert.ok(Date.now() - startedAt < 20_000);
      assert.equal((await connection.query("show statement_timeout")).rows[0].statement_timeout, "2s");
      await blocker.query("rollback");
      assert.ok((await readPriorityCandidates(4663, connection)).length > 0);
    } finally {
      await blocker.query("rollback");
      blocker.release();
    }
  });
});
