import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { readCurrentSwapFigure } from "./status-counts";

test("Status swap count uses current complete selected pool windows with canonical factory identity", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async () => {
  const database = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const client = await database.connect();
  const chainId = 777873;
  const now = new Date("2026-09-14T00:00:00Z");
  const address = `0x${"7".repeat(40)}`;
  try {
    await client.query("begin");
    for (const kind of ["current", "zero", "incomplete", "unselected", "orphaned", "replaced", "selection-replaced"]) {
      const id = randomUUID();
      await client.query(`insert into dex_pools(id,chain_id,venue,currency0,currency1,fee,tick_spacing,hooks,created_block,canonical)
        values($1,$2,'uniswap_v3',$3,$3,3000,60,$3,1,$4)`, [id, chainId, address, kind !== "orphaned"]);
      await client.query(`insert into registry_priority_pools(chain_id,pool_id,address,selected,method,source,factory_created_block,attempted_at)
        values($1,$2,$3,$4,'v3_quote_holdings','fixture',$5,now())`, [chainId, id, address, kind !== "unselected", kind === "selection-replaced" ? 2 : 1]);
      await client.query(`insert into market_pool_swap_metrics(chain_id,pool_id,enrolled_from_block,covered_from_block,factory_created_block,coverage_complete,swaps)
        values($1,$2,1,1,$3,$4,$5)`, [chainId, id, kind === "replaced" ? 2 : 1, kind !== "incomplete", kind === "current" ? 7 : kind === "zero" ? 0 : 100]);
    }
    await client.query(`insert into market_swap_index_state(chain_id,live_start_block,live_start_at,through_block,through_at,through_hash,window_start_block,window_start_at)
      values($1,1,$2,10,$2,'fixture',1,$2::timestamp-interval '1 day')`, [chainId, now.toISOString()]);
    const reading = await readCurrentSwapFigure(chainId, client, now);
    assert.equal(reading.count, 7);
    assert.equal(reading.newestAt?.toISOString(), now.toISOString());
    const expired = await readCurrentSwapFigure(chainId, client, new Date(now.getTime() + 120_001));
    assert.equal(expired.count, 0);
    assert.equal(expired.newestAt, null, "missing current coverage has no fresh timestamp");
    assert.equal((await readCurrentSwapFigure(chainId, client, new Date(now.getTime() - 1))).newestAt, null, "future snapshots are excluded");
  } finally {
    await client.query("rollback");
    client.release();
    await database.end();
  }
});
