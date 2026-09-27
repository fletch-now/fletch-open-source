import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { TOKEN_DISCOVERIES_SQL } from "./discoveries";

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;

test("discoveries include fresh community contracts and preserve identity and observation boundaries", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function discoveries(t) {
  const db = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const schema = `discoveries_${randomUUID().replaceAll("-", "")}`;
  t.after(async () => { await db.query(`drop schema if exists ${schema} cascade`); await db.end(); });
  await db.query(`create schema ${schema}`);
  await db.query(`set search_path to ${schema},public`);
  await db.query("set time zone 'America/New_York'");
  await db.query(`
    create table registry_assets(chain_id integer, address text, symbol text, name text,
      status text, first_seen_at timestamp, metadata_checked_at timestamp);
    create table dex_tokens(chain_id integer, address text, symbol text, name text,
      hidden boolean default false, bytecode_present boolean default true,
      checked_at timestamp default '2026-09-15T08:00:00', error text,
      first_seen_at timestamp default '2026-09-15T07:59:00');
  `);
  await db.query(`insert into registry_assets values
    (4663,$1,'NVDA','NVIDIA','active','2026-09-04T12:00:00','2026-09-15T08:00:00'),
    (4663,$2,'NEW','Newly recorded stock','active','2026-09-15T07:58:00',null),
    (4663,$3,'HIDDEN','Hidden asset','active','2026-09-15T08:00:00',null),
    (46630,$4,'TEST','Other chain','active','2026-09-15T08:00:00',null),
    (4663,$5,'OLD','Inactive asset','inactive','2026-09-15T08:00:00',null)`,
  [address(1), address(2), address(3), address(4), address(5)]);
  await db.query(`insert into dex_tokens(chain_id,address,symbol,name,hidden) values
    (4663,$1,'NVDA','Later metadata',false),
    (4663,$2,'HIDDEN','Hidden asset',true),
    (4663,$3,'FRONG','Frog',false),
    (4663,$4,'NVDA','Community namesake',false),
    (4663,$5,'FRONG','Different frog',false),
    (46630,$6,'TEST','Other chain',false)`,
  [address(1), address(3), address(101), address(102), address(103), address(104)]);
  await db.query(`insert into dex_tokens(chain_id,address,symbol,name,bytecode_present,checked_at,error) values
    (4663,$1,'NOPE','No bytecode',false,'2026-09-15T08:00:00',null),
    (4663,$2,'UNREAD','Unread',true,null,null),
    (4663,$3,'FAIL','Failed read',true,'2026-09-15T08:00:00','rpc failure'),
    (4663,$4,null,null,true,'2026-09-15T08:00:00',null),
    (4663,$5,'  ','Empty symbol',true,'2026-09-15T08:00:00',null)`,
  [address(201), address(202), address(203), address(204), address(205)]);

  const first = (await db.query(TOKEN_DISCOVERIES_SQL, [4663, 50])).rows;
  assert.deepEqual(first.map((row) => row.address), [101, 102, 103, 2, 1].map(address));
  assert.equal(first.filter((row) => row.symbol === "NVDA").length, 2, "same ticker retains both contract addresses");
  assert.equal(first.at(-1).name, "NVIDIA", "asset identity wins over newer metadata");
  assert.equal(first.at(-1).firstSeenAt.toISOString(), "2026-09-04T12:00:00.000Z", "fresh checks do not change the first observation or timezone");
  assert.equal(first[0].firstSeenAt.toISOString(), "2026-09-15T07:59:00.000Z");
  const limited = (await db.query(TOKEN_DISCOVERIES_SQL, [4663, 2])).rows;
  assert.deepEqual(limited.map((row) => row.address), [address(101), address(102)]);

  await db.query(`insert into dex_tokens(chain_id,address,symbol,name,first_seen_at) values
    (4663,$1,'NEXT','Next discovery','2026-09-15T08:01:00')`, [address(300)]);
  const next = (await db.query(TOKEN_DISCOVERIES_SQL, [4663, 6])).rows;
  assert.equal(next[0].address, address(300), "a later read sees discoveries inserted in the background");
  assert.equal(next.at(-1).firstSeenAt.toISOString(), first.at(-1).firstSeenAt.toISOString());
});
