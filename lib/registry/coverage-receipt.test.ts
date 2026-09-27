import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { coverageReceiptStatus, readCoverageReceipt, writeCoverageReceipt, type CoverageReceipt } from "./coverage-receipt";
import { readJobRunSnapshots } from "./authority/job-run-snapshots";

test("receipt age never becomes current by being served again", () => {
  const at = "2026-09-14T00:00:00Z";
  const now = Date.parse(at);
  assert.equal(coverageReceiptStatus(at, now + 120_000), "current");
  assert.equal(coverageReceiptStatus(at, now + 120_001), "stale");
  assert.equal(coverageReceiptStatus(at, now - 1), "stale");
  assert.equal(coverageReceiptStatus(null, now), "unavailable");
});

test("durable receipts retain measured times, reject older writers and survive separate reads", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async () => {
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const client = await database.connect();
  const at = "2026-09-14T00:00:00Z";
  const chainId = 777879;
  const receipt: CoverageReceipt = { version: 1, measuredAt: at,
    scouting: { measuredAt: at, catalogSymbols: 4, matchedTickers: 3, bytecodeCheckedTickers: 2, unmatchedSymbols: ["UNREAD"], pendingPoolTokens: 20, selectedPools: 4, completeVolumePools: 3 },
    swapIndexer: { checkedAt: at, tiers: [{ tier: "active", totalPools: 5, enrolledPools: 4, complete24hPools: 3 }], historicalUsdAvailable: true } };
  try {
    await client.query("begin");
    assert.equal(await readCoverageReceipt(chainId, client), null);
    await writeCoverageReceipt(chainId, receipt, client);
    assert.deepEqual(await readCoverageReceipt(chainId, client), receipt);
    await writeCoverageReceipt(chainId, { ...receipt, measuredAt: "2026-09-13T23:00:00Z" }, client);
    assert.deepEqual(await readCoverageReceipt(chainId, client), receipt, "a slower older publisher cannot replace a newer receipt");
    await client.query("update app_settings set value='invalid JSON' where key=$1", [`registry.coverage:${chainId}`]);
    assert.equal(await readCoverageReceipt(chainId, client), null, "invalid receipts are unavailable, not invented zero counts");
  } finally { await client.query("rollback"); client.release(); await database.end(); }
});

test("indexed job snapshots preserve a prior failure while a retry is running", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async () => {
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const client = await database.connect();
  const job = `snapshot-${randomUUID()}`;
  try {
    await client.query("begin");
    for (const [minute, ok, error] of [[0, true, null], [1, false, "source unavailable"], [2, null, null]] as const) {
      await client.query(`insert into sync_runs(id,job,started_at,finished_at,ok,error,rows,detail)
        values($1,$2,$3,case when $4::boolean is null then null else $3::timestamp+interval '1 second' end,$4,$5,7,'{"measuredAt":"2026-09-14T00:00:00Z"}')`,
      [randomUUID(), job, `2026-09-14T00:0${minute}:00Z`, ok, error]);
    }
    const reading = await readJobRunSnapshots(client, [job, `${job}-missing`]);
    assert.equal(reading.latest.get(job)?.ok, null);
    assert.equal(reading.ok.get(job)?.finishedAt.toISOString(), "2026-09-14T00:00:01.000Z");
    assert.equal(reading.finished.get(job)?.error, "source unavailable");
    assert.deepEqual(reading.finished.get(job)?.detail, { measuredAt: "2026-09-14T00:00:00Z" });
    assert.equal(reading.latest.has(`${job}-missing`), false);
  } finally { await client.query("rollback"); client.release(); await database.end(); }
});
