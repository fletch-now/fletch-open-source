import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";

test("enrollment accepts either valid range source and withdraws missing, old, future or unrelated anchors", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function anchors(): Promise<void> {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const namespace = `swap_anchor_${randomUUID().replaceAll("-", "")}`;
  const previousUrl = process.env.DATABASE_URL;
  const url = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  url.searchParams.set("options", `-c search_path=${namespace} -c timezone=UTC`);
  let close: (() => Promise<void>) | undefined;
  try {
    await admin.query(`create schema ${namespace}`);
    await admin.query(`create table ${namespace}.dex_pools (like public.dex_pools including all)`);
    process.env.DATABASE_URL = url.toString();
    const store = await import("@/lib/db");
    close = store.close;
    const database = store.pool;
    const { enrollSwapPools } = await import("./market-swaps");
    for (const migration of ["0051_market_swap_index.sql", "0056_market_swap_valuation.sql"]) {
      await database.query(await readFile(`drizzle/${migration}`, "utf8"));
    }
    const cases = [
      { name: "pool-only", kind: "pool", from: 90, through: 100, canonical: true, retained: true },
      { name: "backfilled pool", kind: "pool", from: 1, through: 100, canonical: true, retained: true },
      { name: "global-only", kind: "global", from: 80, through: 100, canonical: true, retained: true },
      { name: "neither", kind: "none", from: 90, through: 100, canonical: true, retained: false },
      { name: "global before enrollment", kind: "global", from: 40, through: 100, canonical: true, retained: false },
      { name: "pool ends before tail", kind: "pool", from: 90, through: 99, canonical: true, retained: false },
      { name: "pool starts after tail", kind: "pool", from: 101, through: 110, canonical: true, retained: false },
      { name: "global ends before tail", kind: "global", from: 80, through: 99, canonical: true, retained: false },
      { name: "global starts after tail", kind: "global", from: 101, through: 110, canonical: true, retained: false },
      { name: "orphan pool range", kind: "pool", from: 80, through: 100, canonical: false, retained: false },
      { name: "orphan global range", kind: "global", from: 80, through: 100, canonical: false, retained: false },
      { name: "another pool", kind: "other", from: 80, through: 100, canonical: true, retained: false },
    ];
    for (const [index, fixture] of cases.entries()) {
      const chainId = 778000 + index;
      const id = `pool-${index}`;
      await database.query(`insert into dex_pools(id,chain_id,currency0,currency1,fee,tick_spacing,hooks,created_block)
        values($1,$2,'token','quote',3000,60,'0x00',1)`, [id, chainId]);
      await database.query(`insert into market_swap_index_state(chain_id,live_start_block,live_start_at,through_block,through_at,
        through_hash,window_start_block,window_start_at) values($1,50,now(),100,now(),'tail',1,now()-interval '1 day')`, [chainId]);
      await database.query(`insert into market_pool_swap_metrics(chain_id,pool_id,enrolled_from_block,covered_from_block,
        factory_created_block,coverage_complete,volume_usd,valued_from_block,as_of_at)
        values($1,$2,50,1,1,true,17,1,'2026-09-14 00:00:00')`, [chainId, id]);
      if (fixture.kind !== "none") {
        let rangePool: string | null = id;
        if (fixture.kind === "global") rangePool = null;
        if (fixture.kind === "other") rangePool = "unrelated-pool";
        await database.query(`insert into market_swap_ranges(id,chain_id,pool_id,from_block,through_block,from_hash,through_hash,canonical)
          values($1,$2,$3,$4,$5,'from','through',$6)`, [randomUUID(), chainId, rangePool, fixture.from, fixture.through, fixture.canonical]);
      }
      await enrollSwapPools(chainId, BigInt(101), [id]);
      const row = (await database.query("select *,as_of_at at time zone 'UTC' as source_at from market_pool_swap_metrics where chain_id=$1", [chainId])).rows[0];
      assert.equal(row.coverage_complete, fixture.retained, fixture.name);
      assert.equal(row.covered_from_block, fixture.retained ? "1" : "101", fixture.name);
      assert.equal(row.volume_usd, fixture.retained ? "17" : null, fixture.name);
      assert.equal(row.valued_from_block, fixture.retained ? "1" : null, fixture.name);
      assert.equal(row.source_at.toISOString(), "2026-09-14T00:00:00.000Z", "Enrollment never restamps old metrics as fresh");
    }
  } finally {
    if (close) await close();
    process.env.DATABASE_URL = previousUrl;
    await admin.query(`drop schema if exists ${namespace} cascade`);
    await admin.end();
  }
});
