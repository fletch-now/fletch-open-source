import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { parseContractQuery } from "./contract-search-query";

function address(value: number): string {
  return `0x${value.toString(16).padStart(40, "0")}`;
}

interface Match {
  address: string;
  symbol: string | null;
  name: string | null;
  isin: string | null;
  source: string;
  observedAt: string | null;
  trackedMarket: boolean;
}
interface Page { total: number; items: Match[] }

test("contract search resolves recorded identities across metadata sources", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function contractSearch(t) {
  const previousDatabase = process.env.DATABASE_URL;
  const previousTimezone = process.env.TZ;
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `contract_search_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace},public -c timezone=America/New_York`);
  process.env.DATABASE_URL = url.toString();
  process.env.TZ = "Asia/Tokyo";
  const { pool } = await import("@/lib/db");
  const { contractSearchSql } = await import("./contract-search");
  t.after(async function cleanup() {
    await pool.end();
    await admin.query(`drop schema if exists ${namespace} cascade`);
    await admin.end();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  });
  // This suite runs only against an explicitly supplied disposable test database.
  await admin.query("create extension if not exists pg_trgm");
  await admin.query(`create schema ${namespace}`);
  await admin.query(`set search_path to ${namespace},public`);
  await admin.query(`
    create table registry_assets(chain_id integer,address text,symbol text,name text,isin text,
      onchain_symbol text,onchain_name text,status text,observed_at timestamp);
    create table dex_tokens(chain_id integer,address text,symbol text,name text,hidden boolean not null default false,checked_at timestamp);
    create table lookalike_tokens(chain_id integer,address text,symbol text,name text,matches_symbol text,last_seen_at timestamp);
    create table registry_explorer_candidates(chain_id integer,address text,reported_symbol text,reported_name text,catalog_symbol text,observed_at timestamptz);
    create table dex_pools(chain_id integer,id text,pool_address text,currency0 text,currency1 text,canonical boolean);
    create table registry_priority_tokens(chain_id integer,address text,rank integer);
  `);
  const nvidia = "0x111122223333444455556666777788889999aaaa";
  const tesla = "0x22223333444455556666777788889999aaaabbbb";
  const poolId = `0x${"ab".repeat(32)}`;
  const unconfirmedPoolId = `0x${"cd".repeat(32)}`;
  await pool.query(`insert into registry_assets values
    (4663,$1,'NVDA','NVIDIA Corporation','US67066G1040','NVDA.RH','NVIDIA Robinhood Token','active','2026-09-14T10:00:00'),
    (4663,$2,'TSLA','Tesla Motors','US88160R1014','TSLAX','Tesla Robinhood Token','active','2026-09-14T10:00:00'),
    (4663,$3,'HIDE','Hidden asset',null,null,null,'active','2026-09-14T10:00:00'),
    (4663,$4,'RETIRED','Retired asset',null,null,null,'inactive','2026-09-14T10:00:00'),
    (46630,$5,'NVDA','Other chain token',null,null,null,'active','2026-09-14T10:00:00')`,
  [nvidia, tesla, address(401), address(402), address(403)]);
  await pool.query(`insert into dex_tokens(chain_id,address,symbol,name,hidden,checked_at) values
    (4663,$1,'NVDA','Older NVIDIA metadata',false,'2026-09-14T09:00:00'),
    (4663,$2,'FRONG','Green Hood Frog',false,'2026-09-14T10:01:00'),
    (4663,$3,'JUGGERNAUT','Juggernaut Token',false,'2026-09-14T10:01:00'),
    (4663,$4,'NVDA','Nvidia Community',false,'2026-09-14T10:02:00'),
    (4663,$5,'HIDE','Hidden token',true,'2026-09-14T10:01:00'),
    (4663,$6,null,null,false,null),
    (4663,$7,'P%Q','Percent Token',false,'2026-09-14T10:01:00'),
    (4663,$8,'PZQ','Other Token',false,'2026-09-14T10:01:00'),
    (4663,$9,'UNDER_SCORE','Underscore Token',false,'2026-09-14T10:01:00'),
    (4663,$10,'UNDERXSCORE','Other Token',false,'2026-09-14T10:01:00')`,
  [nvidia, address(101), address(102), address(201), address(401), address(600), address(701), address(702), address(703), address(704)]);
  await pool.query(`insert into lookalike_tokens values
    (4663,$1,'NVDA','Nvidia Fan Club','NVDA','2026-09-14T08:00:00'),
    (4663,$2,'NvDa','Nvidia Token','NVDA','2026-09-14T08:00:00'),
    (4663,$3,'HIDE','Hidden collision','HIDE','2026-09-14T08:00:00')`,
  [address(201), address(202), address(401)]);
  await pool.query(`insert into registry_explorer_candidates values
    (4663,$1,'FROG2','Green Grove','FRONG','2026-09-14T10:03:00Z'),
    (4663,$2,'NVDA','Reported NVIDIA label','NVDA','2026-09-14T08:00:00Z')`,
  [address(301), nvidia]);
  await pool.query(`insert into registry_priority_tokens values(4663,$1,0),(4663,$2,1),(4663,$3,2)`,
  [nvidia, address(202), address(201)]);
  await pool.query(`insert into dex_pools values
    (4663,$1,$2,$3,$4,true),(4663,$5,$6,$3,$7,false),
    (46630,$1,$2,$7,$8,true)`,
  [poolId, address(900), nvidia, address(600), unconfirmedPoolId, address(901), address(101), address(102)]);

  async function search(value: string, options: { similar?: boolean; limit?: number; offset?: number } = {}): Promise<Page> {
    const compiled = contractSearchSql(parseContractQuery(value), options.similar ?? false);
    const result = await pool.query<Page>(compiled.text, [4663, ...compiled.values, options.limit ?? 50, options.offset ?? 0]);
    assert.equal(result.rows.length, 1, "empty pages retain the aggregate result row");
    return result.rows[0];
  }

  await t.test("tickers ignore case and dollar prefixes while canonical metadata wins deduplication", async function tickers() {
    const page = await search(" $nVdA ");
    assert.equal(page.total, 3);
    assert.deepEqual(page.items.map((item) => item.address), [nvidia, address(202), address(201)]);
    assert.equal(page.items[0].source, "asset_list");
    assert.equal(page.items[0].name, "NVIDIA Corporation");
    assert.equal(new Date(page.items[0].observedAt!).toISOString(), "2026-09-14T10:00:00.000Z");
    assert.equal(page.items[2].source, "contract_metadata");
    assert.equal(page.items[2].name, "Nvidia Community");
    assert.ok(page.items.every((item) => item.trackedMarket));
  });

  await t.test("words match across names and tickers in either order", async function words() {
    for (const query of ["hood frog", "FROG HOOD", "frong hood"]) {
      assert.deepEqual((await search(query)).items.map((item) => item.address), [address(101)]);
    }
    const aliases = await search("FRONG");
    assert.deepEqual(aliases.items.map((item) => item.address), [address(101), address(301)]);
    assert.equal(aliases.items[1].source, "explorer_candidate");
    assert.equal(aliases.items[1].trackedMarket, false);
  });

  await t.test("ISIN and recorded on-chain aliases resolve the listed address", async function identityAliases() {
    for (const query of ["us67066g1040", "NVDA.RH", "token nvidia"]) {
      assert.ok((await search(query)).items.some((item) => item.address === nvidia));
    }
    assert.deepEqual((await search("US67066G1040")).items.map((item) => item.address), [nvidia]);
    assert.deepEqual((await search("TSLAX")).items.map((item) => item.address), [tesla]);
  });

  await t.test("mixed timestamp columns retain observation instants outside UTC", async function timestamps() {
    for (const [query, expected] of [
      [nvidia, "2026-09-14T10:00:00.000Z"],
      [address(101), "2026-09-14T10:01:00.000Z"],
      [address(202), "2026-09-14T08:00:00.000Z"],
      [address(301), "2026-09-14T10:03:00.000Z"],
    ]) {
      const found = await search(query);
      assert.equal(found.total, 1);
      assert.equal(new Date(found.items[0].observedAt!).toISOString(), expected);
    }
  });

  await t.test("hidden and inactive records do not leak through another source", async function hidden() {
    for (const query of ["HIDE", address(401), "RETIRED", address(402), address(403)]) {
      assert.deepEqual(await search(query), { total: 0, items: [] });
    }
  });

  await t.test("full addresses, shortened addresses, links and chain-qualified addresses resolve", async function addresses() {
    for (const query of [nvidia.toUpperCase(), "0x1111…aaaa", "0x1111...aaaa", "0x11112222",
      `https://fletch.now/registry/token/${nvidia}`, `eip155:4663:${nvidia}`]) {
      assert.deepEqual((await search(query)).items.map((item) => item.address), [nvidia]);
    }
    const pending = await search(address(600));
    assert.equal(pending.total, 1);
    assert.equal(pending.items[0].address, address(600));
    assert.equal(pending.items[0].symbol, null);
    assert.equal(pending.items[0].observedAt, null);
  });

  await t.test("pool identifiers resolve both currencies, including pending metadata", async function pools() {
    for (const query of [poolId, address(900)]) {
      const page = await search(query);
      assert.equal(page.total, 2);
      assert.deepEqual(new Set(page.items.map((item) => item.address)), new Set([nvidia, address(600)]));
    }
    assert.deepEqual(await search(unconfirmedPoolId), { total: 0, items: [] });
    assert.deepEqual(await search(address(901)), { total: 0, items: [] });
  });

  await t.test("trigram fallback recovers a misspelling only when explicitly selected", async function fuzzy() {
    assert.deepEqual(await search("juggernat"), { total: 0, items: [] });
    const similar = await search("juggernat", { similar: true });
    assert.deepEqual(similar.items.map((item) => item.address), [address(102)]);
  });

  await t.test("the closest spelling precedes a looser match in tracked markets", async function rankedSpelling() {
    await pool.query(`insert into dex_tokens(chain_id,address,symbol,name) values
      (4663,$1,'indusai','indusai app'),(4663,$2,'IND','Industries')`, [address(801), address(802)]);
    await pool.query(`insert into registry_priority_tokens values(4663,$1,0)`, [address(802)]);
    const result = await search("indussai", { similar: true });
    assert.equal(result.items[0].address, address(801));
    assert.ok(result.items.some((item) => item.address === address(802)));
  });

  await t.test("pagination preserves deterministic ordering and totals beyond the last row", async function pagination() {
    const first = await search("nvda", { limit: 1 });
    const second = await search("nvda", { limit: 1, offset: 1 });
    const last = await search("nvda", { limit: 1, offset: 2 });
    assert.deepEqual([first, second, last].map((page) => page.total), [3, 3, 3]);
    assert.deepEqual([first, second, last].map((page) => page.items[0].address), [nvidia, address(202), address(201)]);
    assert.deepEqual(await search("nvda", { limit: 1, offset: 20 }), { total: 3, items: [] });
    assert.deepEqual(await search("nvda", { limit: 1 }), first);
  });

  await t.test("LIKE wildcard input remains literal search text", async function literals() {
    for (const query of ["%", "_", "%_%", "\\", "' UNION SELECT pg_sleep(1); --"]) {
      assert.deepEqual(await search(query), { total: 0, items: [] });
    }
    assert.deepEqual((await search("P%Q")).items.map((item) => item.address), [address(701)]);
    assert.deepEqual((await search("UNDER_SCORE")).items.map((item) => item.address), [address(703)]);
  });
});
