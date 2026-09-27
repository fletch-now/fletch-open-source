import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";

test("public counters retain source evidence, use trust definitions and retry unavailable readings", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function counters(t) {
  const previousDatabase = process.env.DATABASE_URL;
  const previousTimezone = process.env.TZ;
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL });
  const namespace = `public_numbers_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  // A missing fixture table must fail instead of falling through to public data.
  url.searchParams.set("options", `-c search_path=${namespace} -c timezone=UTC`);
  process.env.DATABASE_URL = url.toString();
  process.env.TZ = "UTC";
  const { pool } = await import("@/lib/db");
  t.after(async function cleanup() {
    try {
      await pool.end();
      await admin.query(`drop schema if exists ${namespace} cascade`);
    } finally {
      await admin.end();
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  await admin.query(`create schema ${namespace}`);
  for (const table of ["registry_assets", "registry_asset_state", "registry_control_state", "registry_supply_snapshots", "lookalike_tokens", "authority_events", "sync_runs", "sync_checkpoints", "sync_checkpoint_history", "chain_health", "daemon_heartbeats"]) {
    await admin.query(`create table ${namespace}.${table} (like public.${table} including all)`);
  }
  const { JOB_NAMES } = await import("@/lib/registry/authority/cadence");
  const { readPublicRegistryNumbers, registryNumberStats } = await import("./public-numbers");
  const { DocsLiveNumbers } = await import("@/components/docs/live-numbers");
  const { renderToStaticMarkup } = await import("react-dom/server");

  const stamp = new Date(Date.now() - 86_400_000);
  for (const [id, status, onchainSymbol, onchainDecimals] of [
    ["good", "active", "GOOD", 18],
    ["wrong-symbol", "active", "OTHER", 18],
    ["wrong-decimals", "active", "WRONG-DECIMALS", 6],
    ["inactive", "inactive", "INACTIVE", 18],
  ]) {
    await pool.query(`insert into registry_assets
      (id,chain_id,address,symbol,name,asset_type,source,decimals,status,verified_at,onchain_symbol,onchain_decimals,observed_at)
      values($1,4663,$1,upper($1),$1,'stock_token','fixture',18,$2,now(),$3,$4,$5)`,
    [id, status, onchainSymbol, onchainDecimals, stamp]);
  }
  await pool.query(`insert into registry_asset_state
    (asset_id,chain_id,address,canonical,canonical_checked_at,feed_price,feed_checked_at)
    values('good',4663,'good',true,$1,12,$1)`, [stamp]);
  for (const kind of ["impostor", "unlisted_stock"]) {
    await pool.query(`insert into lookalike_tokens(id,chain_id,address,matches_asset_id,matches_symbol,kind)
      values($1,4663,$1,'good','GOOD',$1)`, [kind]);
  }
  await pool.query(`insert into authority_events(id,chain_id,kind,title,occurred_at,observed_at) values
    ('old-event-new-observation',4663,'fixture','Fixture',now()-interval '30 days',now()),
    ('old-observation',4663,'fixture','Fixture',now()-interval '8 days',now()-interval '8 days'),
    ('other-chain',46630,'fixture','Fixture',now(),now())`);
  for (const job of JOB_NAMES) {
    await pool.query(`insert into sync_runs(id,job,started_at,finished_at,ok,rows)
      values($1,$1,now()-interval '3 seconds',now()-interval '2 seconds',true,0)`, [job]);
  }
  // The overall verdict becomes degraded at ten unhealthy jobs; a single
  // failure remains visible in the summary without crossing that threshold.
  const failedJobs = ["lookalikes", ...JOB_NAMES.filter(job => job !== "lookalikes").slice(0, 9)];
  for (const job of failedJobs) {
    await pool.query(`insert into sync_runs(id,job,started_at,finished_at,ok,error)
      values($1,$2,now()-interval '1 second',now(),false,'Fixture provider unavailable')`, [`failed-${job}`, job]);
  }
  await pool.query("insert into daemon_heartbeats(name,last_beat_at) values('registry-daemon',now())");

  let clock = Date.now();
  t.mock.method(Date, "now", function now() { return clock; });
  await pool.query("alter table authority_events rename to unavailable_events");
  assert.equal(await readPublicRegistryNumbers(), null);
  assert.ok(registryNumberStats(null).every(row => row.value === "—"));
  const unavailableHtml = renderToStaticMarkup(await DocsLiveNumbers());
  assert.match(unavailableHtml, /reading is unavailable/);
  assert.doesNotMatch(unavailableHtml, /<time/);
  await pool.query("alter table unavailable_events rename to authority_events");

  const first = await readPublicRegistryNumbers();
  assert.ok(first, "the next request retries an unavailable reading immediately");
  assert.equal(first.assets, 3);
  assert.equal(first.verified, 1, "symbol, decimals and active status all constrain the verified population");
  assert.equal(first.canonical, 1);
  assert.equal(first.feedsRead, 1, "older observations remain countable without becoming fresh");
  assert.equal(first.lookalikes, 2, "legacy beacon matches remain collision evidence");
  assert.equal(first.changesThisWeek, 1, "count by observation time on the requested chain");
  assert.equal(first.verdict, "degraded");
  assert.match(first.summary, /lookalikes/);
  assert.equal(first.observedAt.listings?.toISOString(), stamp.toISOString());
  assert.equal(first.observedAt.canonical?.toISOString(), stamp.toISOString());
  assert.equal(first.observedAt.feeds?.toISOString(), stamp.toISOString());
  assert.ok(first.checkedAt.getTime() - stamp.getTime() >= 86_400_000);
  const html = renderToStaticMarkup(await DocsLiveNumbers());
  assert.match(html, /degraded/);
  assert.match(html, /including older readings/);
  assert.ok(html.includes(first.checkedAt.toISOString()));
  assert.ok(html.includes(stamp.toISOString()));

  await pool.query(`insert into authority_events(id,chain_id,kind,title,occurred_at,observed_at)
    values('new-observation',4663,'fixture','Fixture',now(),now())`);
  clock += 9_999;
  const cached = await readPublicRegistryNumbers();
  assert.equal(cached, first, "the cached count and measured timestamp stay together");
  assert.equal(cached.changesThisWeek, 1);
  clock += 1;
  const refreshed = await readPublicRegistryNumbers();
  assert.ok(refreshed);
  assert.notEqual(refreshed, first);
  assert.equal(refreshed.changesThisWeek, 2, "after ten seconds the real query sees the newly recorded change");
  assert.equal(refreshed.verdict, "degraded");
  assert.equal(refreshed.observedAt.feeds?.toISOString(), stamp.toISOString(), "refreshing a summary never refreshes its source age");
});
