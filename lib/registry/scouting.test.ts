import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

test("scouting reports every catalog symbol and keeps bytecode evidence separate from ticker matches", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function coverage() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { pool, close } = await import("@/lib/db");
  const { readScoutingCoverage } = await import("./scouting");
  const client = await pool.connect();
  const chainId = 777361;
  try {
    await client.query("begin");
    assert.equal(Number((await client.query("select count(*) from robinhood_app_pairs")).rows[0].count), 0, "Use the isolated test database");
    for (const symbol of ["SCOUTMATCH", "SCOUTUNREAD", "SCOUTMISSING"]) {
      await client.query("insert into robinhood_app_pairs(id,symbol,name,pair,first_observed_at,observed_at) values($1,$2,$2,'{}',now(),now())", [randomUUID(), symbol]);
    }
    await client.query(`insert into dex_tokens(id,chain_id,address,symbol,bytecode_present) values
      ($1,$2,$3,'SCOUTMATCH',true),($4,$2,$5,'SCOUTUNREAD',false),($6,$7,$8,'SCOUTMISSING',true)`,
    [randomUUID(), chainId, `0x${"1".repeat(40)}`, randomUUID(), `0x${"2".repeat(40)}`, randomUUID(), chainId + 1, `0x${"3".repeat(40)}`]);
    const reading = await readScoutingCoverage(chainId, client);
    assert.equal(reading.catalogSymbols, 3);
    assert.equal(reading.matchedTickers, 2);
    assert.equal(reading.bytecodeCheckedTickers, 1);
    assert.deepEqual(reading.unmatchedSymbols, ["SCOUTMISSING"]);
    assert.equal(reading.selectedPools, 0);
    assert.ok(Date.now() - Date.parse(reading.measuredAt) < 1000);
  } finally {
    await client.query("rollback");
    client.release();
    await close();
  }
});
