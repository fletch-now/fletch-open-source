import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { publishRegistryCoverage } from "./coverage-publisher";
import { readCoverageReceipt } from "./coverage-receipt";

test("coverage uses one connection and a timed-out publication preserves the last complete receipt", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
  timeout: 30_000,
}, async function publication(t): Promise<void> {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `coverage_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1, connectionTimeoutMillis: 200, options: `-c search_path=${namespace} -c timezone=UTC` });
  t.after(async function cleanup() { await database.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await database.query(`create table app_settings(key text primary key,value text,updated_at timestamptz default now());
    create table robinhood_app_pairs(symbol text,present boolean,observed_at timestamp);
    create table dex_tokens(chain_id integer,symbol text,address text,bytecode_present boolean,hidden boolean);
    create table registry_assets(chain_id integer,symbol text,address text,verified_at timestamp,status text);
    create table dex_pools(id text,chain_id integer,token_address text,canonical boolean,tier text,created_block bigint,created_block_hash text);
    create table registry_priority_pools(chain_id integer,pool_id text,selected boolean);
    create table market_pool_swap_metrics(chain_id integer,pool_id text,factory_created_block bigint,factory_created_hash text,
      coverage_complete boolean,swaps bigint,transactions bigint,volume_usd numeric,volume_valuation jsonb);
    create table registry_explorer_searches(chain_id integer,symbol text,completed_at timestamp,observed_at timestamp,catalog_at timestamp,next_page jsonb,error text);
    create table registry_explorer_candidates(chain_id integer,address text);
    create table registry_token_observations(chain_id integer,address text,metadata jsonb);
    create table market_swap_index_state(chain_id integer,through_block bigint,through_at timestamp,window_start_at timestamp);
    create table chain_health(chain_id integer,head_block bigint,checked_at timestamp);
    insert into robinhood_app_pairs values('ONE',true,now());
    insert into registry_assets values(4663,'ONE','token',now(),'active');
    insert into dex_pools values('pool',4663,'token',true,'active',1,'block-hash');
    insert into registry_priority_pools values(4663,'pool',true);
    insert into market_pool_swap_metrics values(4663,'pool',1,'block-hash',true,7,5,12,'{"method":"historical_chainlink_window_start"}');
    insert into market_swap_index_state values(4663,100,now(),now()-interval '1 day');
    insert into chain_health values(4663,101,now())`);
  let acquisitions = 0;
  database.on("acquire", function acquired() { acquisitions++; });
  const measuredAt = await publishRegistryCoverage(4663, database);
  assert.equal(acquisitions, 1, "Every aggregate and the final write share the accepted connection");
  const saved = await readCoverageReceipt(4663, database);
  assert.equal(saved?.measuredAt, measuredAt);
  assert.equal(saved?.scouting.matchedTickers, 1);
  assert.equal(saved?.scouting.completeVolumePools, 1);
  assert.equal(saved?.swapIndexer.tiers.find(function active(tier) { return tier.tier === "active"; })?.complete24hPools, 1);
  assert.equal(saved?.swapIndexer.historicalUsdAvailable, true);

  const blocker = await admin.connect();
  try {
    await blocker.query("begin");
    await blocker.query(`select value from ${namespace}.app_settings where key='registry.coverage:4663' for update`);
    await assert.rejects(publishRegistryCoverage(4663, database), function timedOut(error: unknown): boolean {
      assert.equal((error as { code?: string }).code, "57014", "PostgreSQL cancels the blocked statement itself");
      return true;
    });
    assert.deepEqual(await readCoverageReceipt(4663, database), saved, "A failed replacement cannot freshen the old receipt");
    assert.equal((await database.query("show statement_timeout")).rows[0].statement_timeout, "0", "The deadline is local to publication");
  } finally {
    await blocker.query("rollback");
    blocker.release();
  }
  assert.equal(database.waitingCount, 0);
});
