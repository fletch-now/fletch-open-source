import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Pool } from "pg";
import { encodeAbiParameters, encodeEventTopics, type PublicClient } from "viem";

// Exercise the real log decoder, SQL projection and retry against an isolated
// schema. No production environment, token contract or oracle is contacted.
test("selected-pool USDG and historical WETH values require complete logs and preserve quote evidence through retry", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function () {
  const admin = new Pool({ connectionString: process.env.FLETCH_TEST_DATABASE_URL, max: 1 });
  const fixtureSchema = `swap_value_${randomUUID().replaceAll("-", "")}`;
  const previousUrl = process.env.DATABASE_URL;
  const connection = new URL(process.env.FLETCH_TEST_DATABASE_URL!);
  connection.searchParams.set("options", `-c search_path=${fixtureSchema}`);
  const originalFetch = globalThis.fetch;
  let close: (() => Promise<void>) | undefined;
  try {
    await admin.query(`create schema ${fixtureSchema}`);
    for (const table of ["dex_pools", "dex_tokens", "chain_health", "sync_checkpoints", "sync_checkpoint_history"]) {
      await admin.query(`create table ${fixtureSchema}.${table} (like public.${table} including all)`);
    }
    process.env.DATABASE_URL = connection.toString();
    const store = await import("@/lib/db");
    close = store.close;
    const { db, pool } = store;
    const { sql } = await import("drizzle-orm");
    const { dexPools } = await import("@/lib/db/schema");
    const { scanLiveMarketSwaps, backfillMarketSwaps, revalueMarketSwaps, readCurrentMarketSwapMetrics } = await import("./market-swaps");
    const { readSwapIndexer } = await import("./market-swap-status");
    const { SWAP_USDG, SWAP_WETH } = await import("./market-swap-valuation");
    const { UNISWAP_V3_POOL_ABI } = await import("./abis");
    for (const file of ["0051_market_swap_index.sql", "0055_registry_priority.sql", "0056_market_swap_valuation.sql", "0058_registry_quote_observation.sql"]) {
      await db.execute(sql.raw(await readFile(`drizzle/${file}`, "utf8")));
    }
    const addresses = [1, 2, 3, 4].map((n) => `0x${n.toString(16).padStart(40, "0")}` as `0x${string}`);
    const ids = addresses.slice(0, 3);
    let head = BigInt(100_000);
    const origin = Math.floor(Date.now() / 1000) - Number(head) - 1000;
    let oracleFailed = true;
    const archiveReads: bigint[] = [];
    let forkAfter = BigInt(999_999);
    const hash = (n: bigint) => `0x${(n + (n > forkAfter ? BigInt(1_000_000) : BigInt(0))).toString(16).padStart(64, "0")}` as `0x${string}`;
    const base = { chainId: 4663, venue: "uniswap_v3", currency0: addresses[3], fee: 3000, tickSpacing: 60,
      hooks: addresses[3], createdBlock: BigInt(1), priceUsd: "999999", depthUsd: "1000", firstSeenAt: new Date(0) };
    await db.insert(dexPools).values(addresses.map((id, i) => ({ ...base, id, poolAddress: id,
      currency1: i === 0 ? SWAP_USDG : i === 1 ? SWAP_WETH : addresses[3] })));
    for (const id of ids) await pool.query(`insert into registry_priority_pools(chain_id,pool_id,address,selected,method,source,attempted_at,factory_created_block)
      values(4663,$1,$2,$3,'v3_quote_holdings','fixture',now(),1)`, [id, addresses[3], id !== ids[2]]);
    globalThis.fetch = async function directory(input) {
      assert.equal(String(input), "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json");
      return Response.json([{ name: "ETH / USD", proxyAddress: addresses[3], decimals: 8, heartbeat: 86400 }]);
    };
    const block = head - BigInt(100);
    const client = {
      getBlockNumber: async () => head + BigInt(30),
      getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber, hash: hash(blockNumber), timestamp: BigInt(origin) + blockNumber }),
      readContract: async ({ blockNumber }: { blockNumber: bigint }) => {
        archiveReads.push(blockNumber);
        if (oracleFailed) throw new Error("fixture archive outage");
        return [BigInt(10), BigInt(2000_00000000), BigInt(origin) + blockNumber - BigInt(100), BigInt(origin) + blockNumber - BigInt(100), BigInt(10)];
      },
      getLogs: async ({ address, fromBlock, toBlock }: { address: string[]; fromBlock: bigint; toBlock: bigint }) => {
        assert.ok(Array.isArray(address), "v3 logs always have an explicit priority address filter");
        if (block < fromBlock || block > toBlock) return [];
        return ids.filter((id) => address.includes(id)).map((id) => ({ address: id, blockNumber: block, blockHash: hash(block),
          transactionHash: hash(BigInt(ids.indexOf(id) + 1)), logIndex: ids.indexOf(id), transactionIndex: ids.indexOf(id), removed: false,
          topics: encodeEventTopics({ abi: UNISWAP_V3_POOL_ABI, eventName: "Swap", args: { sender: addresses[3], recipient: addresses[3] } }),
          data: encodeAbiParameters([{ type: "int256" }, { type: "int256" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }],
            [BigInt(999_999), id === ids[0] ? BigInt(-1234567) : BigInt(-1_000_000_000_000_000_000), BigInt(1), BigInt(1), 0]),
        }));
      },
    } as unknown as PublicClient;
    await scanLiveMarketSwaps(4663, client, ids);
    const asOf = () => new Date((origin + Number(head)) * 1000);
    let metrics = await readCurrentMarketSwapMetrics(4663, ids, asOf());
    assert.equal(metrics.get(ids[0])?.volumeUsd24h, null, "measured partial USDG volume is not a 24-hour figure");
    assert.equal((await pool.query("select count(*)::integer n from market_pool_swap_metrics")).rows[0].n, 3, "unselected pools are never enrolled");
    await backfillMarketSwaps(4663, client, ids);
    metrics = await readCurrentMarketSwapMetrics(4663, ids, asOf());
    assert.equal(Number(metrics.get(ids[0])?.volumeUsd24h), 1.234567, "USDG remains available when the archive oracle fails");
    assert.equal(metrics.get(ids[0])?.volumeValuation?.method, "usdg_nominal");
    assert.equal(metrics.get(ids[1])?.coverageComplete, true, "raw coverage and quote availability are independent");
    assert.equal(metrics.get(ids[1])?.volumeUsd24h, null);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.reason, "historical_quote_unavailable");
    assert.equal(metrics.get(ids[2])?.volumeValuation?.reason, "unsupported_quote_currency");
    const status = await readSwapIndexer(4663, asOf());
    assert.equal(status.priorityPoolCount, 2);
    assert.equal(status.priorityComplete24hPools, 2);
    assert.equal(status.priorityValued24hPools, 1, "priority raw and priced coverage remain separate");
    assert.equal(status.tiers.reduce((sum, tier) => sum + tier.totalPools, 0), 4, "legacy tier totals explicitly retain the whole canonical catalog");
    assert.equal(status.tiersScope, "canonical_catalog_pools");
    assert.equal(status.coverageScope, "priority_pools");
    assert.equal((await pool.query("select log_data,log_topics from market_swap_events limit 1")).rows[0].log_topics.length, 3);
    assert.ok(archiveReads.every((n) => n <= block), "historical swaps never receive a current-head quote");
    oracleFailed = false;
    await pool.query("update market_swap_events set valuation=valuation-'attemptedAt' where volume_usd is null");
    await revalueMarketSwaps(4663, client, ids);
    metrics = await readCurrentMarketSwapMetrics(4663, ids, asOf());
    assert.equal(Number(metrics.get(ids[1])?.volumeUsd24h), 2000);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.method, "historical_chainlink_window_start");
    assert.equal(metrics.get(ids[1])?.volumeValuation?.estimated, true);
    assert.ok(metrics.get(ids[1])?.volumeValuation?.sampledFrom);
    assert.ok(metrics.get(ids[1])?.volumeValuation?.oracleUpdatedFrom);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.reason, null);
    const raw = await pool.query("select valuation,volume_usd from market_swap_events where pool_id=$1", [ids[1]]);
    assert.equal(raw.rows[0].valuation.sampledBlock, block.toString());
    assert.equal(raw.rows[0].valuation.maxOracleAgeSeconds, 86400);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.maxOracleAgeSeconds, 86400);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.maxSampleAgeSeconds, 3600);
    assert.equal(metrics.get(ids[1])?.volumeValuation?.heartbeatSource, "https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json");
    assert.equal(Number(raw.rows[0].volume_usd), 2000);
    assert.equal((await readSwapIndexer(4663, asOf())).priorityValued24hPools, 2);
    // An inherited minimum marker can hide a hole inside otherwise retained
    // history. Reproduce it, plus a falsely old pricing marker, without a new
    // live tick: backfill must repair actual evidence rather than trust either.
    const crossing = await pool.query("select * from market_swap_ranges where canonical and from_block<=90000 and through_block>=90010");
    assert.ok(crossing.rows.length > 0);
    for (const range of crossing.rows) {
      await pool.query("update market_swap_ranges set canonical=false where id=$1", [range.id]);
      await pool.query(`insert into market_swap_ranges(id,chain_id,pool_id,from_block,through_block,from_hash,through_hash) values
        ($1,4663,$2,$3,89999,$4,$5),($6,4663,$2,90011,$7,$8,$9)`,
      [randomUUID(),range.pool_id,range.from_block,range.from_hash,hash(BigInt(89999)),randomUUID(),range.through_block,hash(BigInt(90011)),range.through_hash]);
    }
    await pool.query("update market_pool_swap_metrics set covered_from_block=1,valued_from_block=1,coverage_complete=false,volume_usd=null");
    await pool.query("update market_swap_events set volume_usd=null,valuation=null where pool_id=$1", [ids[1]]);
    for (let tick=0; tick<6; tick++) {
      await backfillMarketSwaps(4663, client, ids);
      const repaired = await readCurrentMarketSwapMetrics(4663, ids, asOf());
      if (ids.every((id) => repaired.get(id)?.coverageComplete) && Number(repaired.get(ids[1])?.volumeUsd24h)===2000) break;
    }
    const repaired = await readCurrentMarketSwapMetrics(4663, ids, asOf());
    assert.ok(ids.every((id) => repaired.get(id)?.coverageComplete), "interior raw coverage gaps are filled even when the old minimum marker precedes the window");
    assert.equal(Number(repaired.get(ids[0])?.volumeUsd24h),1.234567);
    assert.equal(Number(repaired.get(ids[1])?.volumeUsd24h),2000, "latest unvalued mined event overrides an inherited pricing marker");

    assert.equal(metrics.get(ids[3])?.volumeUsd24h, undefined);
    // Removing a priority pool must withdraw its current metric; re-adding it
    // after a missing tail interval requires backfill instead of a false zero.
    head += BigInt(100);
    await scanLiveMarketSwaps(4663, client, [ids[0]]);
    assert.equal((await readCurrentMarketSwapMetrics(4663, ids, asOf())).get(ids[1])?.current, false);
    head += BigInt(100);
    await scanLiveMarketSwaps(4663, client, ids);
    assert.equal((await readCurrentMarketSwapMetrics(4663, ids, asOf())).get(ids[1])?.coverageComplete, false);
    await backfillMarketSwaps(4663, client, ids);
    assert.equal((await readCurrentMarketSwapMetrics(4663, ids, asOf())).get(ids[1])?.coverageComplete, true);
    forkAfter = head - BigInt(500);
    const rewound = await scanLiveMarketSwaps(4663, client, ids);
    assert.equal(rewound.detail?.reorgRewound, true);
    assert.equal((await readCurrentMarketSwapMetrics(4663, ids, asOf())).get(ids[1])?.volumeUsd24h, null);
    assert.equal((await pool.query("select count(*)::integer n from market_swap_events where not canonical and volume_usd is not null")).rows[0].n, 2,
      "a fork withdraws priced volume while preserving both priced orphan logs for audit");
  } finally {
    globalThis.fetch = originalFetch;
    if (close) await close();
    process.env.DATABASE_URL = previousUrl;
    await admin.query(`drop schema if exists ${fixtureSchema} cascade`);
    await admin.end();
  }
});
