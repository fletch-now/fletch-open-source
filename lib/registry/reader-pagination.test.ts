import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

test("listed and collision reads paginate matching database rows with stable ties", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function databasePages(t) {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `reader_pages_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public`);
  process.env.DATABASE_URL = url.toString();
  const { pool, close } = await import("@/lib/db");
  t.after(async function cleanup() {
    await close();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
  });
  for (const table of ["registry_assets", "registry_asset_state", "lookalike_tokens", "asset_concentration"]) {
    await pool.query(`create table ${table} (like public.${table} including all)`);
  }
  await pool.query("alter table registry_assets add column if not exists metadata_checked_at timestamp");
  await pool.query(`insert into registry_assets(id,chain_id,address,symbol,name,asset_type,source)
    select 'listed-'||n, 778899, '0x'||lpad(to_hex(n),40,'0'), 'SAME', 'Asset '||lpad(n::text,3,'0'),
      case when n<=52 then 'stock_token' else 'stablecoin' end, 'synthetic-fixture' from generate_series(1,72) n`);
  await pool.query(`insert into lookalike_tokens(id,chain_id,address,symbol,name,matches_asset_id,matches_symbol,kind,holders)
    select 'match-'||n,778899,'0x'||lpad(to_hex(n+100),40,'0'),'SAME','Other '||n,'listed-1','SAME',
      case when n<=52 then 'same_ticker' else 'impostor' end,case when n<=50 then 10 else null end from generate_series(1,72) n`);
  const { browseAssetsPage, parseFilters } = await import("@/lib/registry/browse");
  const { lookalikesPage } = await import("@/lib/registry/authority/read");
  const filters = parseFilters({ type: "stock_token", sort: "symbol" });
  const first = await browseAssetsPage(778899, filters, { limit: 25, offset: 0 });
  const second = await browseAssetsPage(778899, filters, { limit: 25, offset: 25 });
  const last = await browseAssetsPage(778899, filters, { limit: 25, offset: 50 });
  assert.equal(first.total, 52);
  assert.deepEqual([first.rows.length, second.rows.length, last.rows.length], [25, 25, 2]);
  assert.equal(new Set([...first.rows, ...second.rows, ...last.rows].map((row) => row.id)).size, 52);
  assert.ok(first.rows[24].address < second.rows[0].address);
  assert.equal((await browseAssetsPage(778899, filters, { limit: 1000, offset: 0 })).rows.length, 50);
  await pool.query(`insert into registry_asset_state(asset_id,chain_id,address,feed_price,ui_multiplier,state_checked_at,canonical,token_paused)
    select 'listed-'||n,778899,'0x'||lpad(to_hex(n),40,'0'),case when n=1 then null when n=3 then 2 else n end,
      case when n=1 then null else n end,
      case when n=1 then null else now() end,true,n=72 from generate_series(1,72) n`);
  await pool.query(`update registry_assets set verified_at=now(),onchain_symbol=case when id='listed-71' then 'WRONG' else symbol end,
    onchain_decimals=decimals where id in ('listed-70','listed-71')`);
  const sorted = async function sortedRows(sort: string, order: string, offset = 0, extra: Record<string, string> = {}) {
    return browseAssetsPage(778899, parseFilters({ sort, order, ...extra }), { limit: 25, offset });
  };
  assert.equal((await sorted("name", "desc")).rows[0].id, "listed-72", "descending applies before the first 25 rows are selected");
  assert.equal((await sorted("address", "desc")).rows[0].id, "listed-72");
  assert.equal((await sorted("type", "asc")).rows[0].assetType, "stablecoin");
  assert.equal((await sorted("type", "desc")).rows[0].assetType, "stock_token");
  assert.equal((await sorted("price", "desc")).rows[0].id, "listed-72");
  const ascending = await sorted("price", "asc");
  assert.deepEqual(ascending.rows.slice(0, 2).map((row) => row.id), ["listed-2", "listed-3"], "equal numeric values use stable address order");
  for (const order of ["asc", "desc"]) {
    assert.equal((await sorted("price", order, 50)).rows.at(-1)?.id, "listed-1", "unread price sorts last in either direction");
    assert.equal((await sorted("multiplier", order, 50)).rows.at(-1)?.id, "listed-1");
    assert.equal((await sorted("state", order, 50)).rows.at(-1)?.id, "listed-1");
  }
  assert.equal((await sorted("verified", "desc")).rows[0].id, "listed-70", "identity sorts verified agreement, not the mere existence of a recent receipt");
  assert.equal((await sorted("verified", "asc")).rows[0].id, "listed-1");
  assert.equal((await sorted("lookalikes", "desc")).rows[0].id, "listed-1");
  assert.equal((await sorted("lookalikes", "asc")).rows[0].id, "listed-2");
  assert.equal((await sorted("state", "desc")).rows[0].id, "listed-72", "paused sorts by the displayed label");
  const filtered = await sorted("price", "desc", 0, { type: "stock_token", state: "feed", q: "SAME" });
  assert.equal(filtered.total, 51);
  assert.equal(filtered.rows[0].id, "listed-52");
  const verified = await browseAssetsPage(778899, parseFilters({ sort: "name", order: "desc" }), { limit: 25, offset: 0 }, { trust: "verified", symbols: ["SAME"] });
  assert.equal(verified.total, 1);
  assert.equal(verified.rows[0].id, "listed-70");
  assert.equal((await browseAssetsPage(778899, parseFilters({}), { limit: 25, offset: 0 }, { trust: "community" })).total, 0);
  assert.deepEqual(parseFilters({ sort: "constructor", order: "invalid", type: "constructor", state: "constructor" }),
    { q: "", sort: "symbol", order: "asc", type: "all", state: "all", verifiedOnly: false });
  const matches = await lookalikesPage(778899, { symbol: "SAME", kind: "same_ticker", limit: 25, offset: 25 });
  assert.equal((await lookalikesPage(778899, { limit: 300, offset: 0 })).rows.length, 72, "public API retains its existing 300-row default above the UI page size");
  assert.equal(matches.total, 52);
  assert.equal(matches.rows.length, 25);
  assert.ok(matches.rows.every((row) => row.kind === "same_ticker"));
  const tail = await lookalikesPage(778899, { symbol: "SAME", kind: "same_ticker", limit: 25, offset: 50 });
  assert.equal(tail.rows.length, 2);
  assert.ok(tail.rows.every((row) => row.holders === null));
  assert.equal((await lookalikesPage(778899, { symbol: "ABSENT", limit: 25, offset: 0 })).total, 0);
  assert.equal((await lookalikesPage(778900, { limit: 25, offset: 0 })).total, 0);
});
