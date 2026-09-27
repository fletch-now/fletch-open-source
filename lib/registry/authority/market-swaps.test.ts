import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { encodeAbiParameters, encodeEventTopics, type PublicClient } from "viem";
import { assertWindowHeaders, firstBlockAfter, intervalsCover } from "./market-swap-window";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("rolling timestamp boundary excludes repeated cutoff timestamps and includes the exact end", async function () {
  const timestamps = [0, 86_400, 86_400, 86_401, 172_800];
  async function read(number: bigint) { return { number, timestamp: BigInt(timestamps[Number(number)]), hash: String(number) }; }
  assert.equal((await firstBlockAfter(read, await read(BigInt(4)), BigInt(86_400))).number, BigInt(3));
  assert.equal((await firstBlockAfter(read, await read(BigInt(4)), BigInt(-1))).number, BigInt(0));
  await assert.rejects(firstBlockAfter(read, await read(BigInt(4)), BigInt(172_800)), /bounds/);
  await assert.rejects(firstBlockAfter(async (number) => ({ number, timestamp: number === BigInt(2) ? BigInt(999999) : BigInt(0), hash: "x" }),
    { number: BigInt(4), timestamp: BigInt(100), hash: "x" }, BigInt(50)), /Nonmonotonic/);
  assert.throws(() => assertWindowHeaders({ number: BigInt(1), timestamp: BigInt(10), hash: "a" },
    { number: BigInt(2), timestamp: BigInt(20), hash: "b" }, 19_999), /future/);
});

test("coverage unions overlaps and adjacent windows while retaining a one-block gap", function () {
  assert.equal(intervalsCover([{ from: BigInt(1), through: BigInt(3) }, { from: BigInt(3), through: BigInt(5) }, { from: BigInt(6), through: BigInt(9) }], BigInt(1), BigInt(9)), true);
  assert.equal(intervalsCover([{ from: BigInt(1), through: BigInt(3) }, { from: BigInt(5), through: BigInt(9) }], BigInt(1), BigInt(9)), false);
});

test("live tail, concurrent discovery, exact raw legs, backfill, restart and fork recovery preserve provenance", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function () {
  const { db, close } = await import("@/lib/db");
  const schema = await import("@/lib/db/schema");
  const { scanLiveMarketSwaps, backfillMarketSwaps, projectSwapMetrics, readCurrentMarketSwapMetrics, enrollSwapPools } = await import("./market-swaps");
  const { UNISWAP_V3_POOL_ABI } = await import("./abis");
  const chainId = 777367;
  await db.execute(sql.raw(await readFile("drizzle/0051_market_swap_index.sql", "utf8")));
  await db.execute(sql.raw(await readFile("drizzle/0056_market_swap_valuation.sql", "utf8")));
  const ids = [1, 2, 3].map((index) => `0x${(77736700 + index).toString(16).padStart(40, "0")}` as `0x${string}`);
  const base = { chainId, venue: "uniswap_v3", currency0: "0x0000000000000000000000000000000000000001", currency1: "0x0000000000000000000000000000000000000002", fee: 3000, tickSpacing: 60, hooks: "0x00", createdBlock: BigInt(1), firstSeenAt: new Date(0), depthUsd: "1000", priceUsd: "999999" };
  const head = BigInt(100_000);
  let latest = head + BigInt(30);
  const origin = Math.floor(Date.now() / 1000) - Number(head) - 3600;
  let forkAfter = BigInt(999_999);
  let mutateDiscovery = true;
  let refuse = false;
  let maxLogWidth: bigint | null = null;
  const requests: { from: bigint; through: bigint; address: unknown }[] = [];
  function hash(number: bigint): `0x${string}` { return `0x${(number + (number > forkAfter ? BigInt(1_000_000) : BigInt(0))).toString(16).padStart(64, "0")}`; }
  async function getBlock({ blockNumber }: { blockNumber: bigint }) {
    return { number: blockNumber, timestamp: BigInt(origin) + blockNumber, hash: hash(blockNumber) };
  }
  const swapBlock = head - BigInt(100);
  function log(logIndex: number) {
    return { address: ids[0], blockNumber: swapBlock, blockHash: hash(swapBlock), transactionHash: `0x${"a".repeat(64)}`,
      logIndex, transactionIndex: 0, removed: false,
      topics: encodeEventTopics({ abi: UNISWAP_V3_POOL_ABI, eventName: "Swap", args: { sender: ids[0], recipient: ids[1] } }),
      data: encodeAbiParameters([{ type: "int256" }, { type: "int256" }, { type: "uint160" }, { type: "uint128" }, { type: "int24" }], [BigInt(2), BigInt(-3), BigInt(1), BigInt(1), 0]) };
  }
  const client = { getBlockNumber: async () => latest, getBlock,
    getLogs: async ({ fromBlock, toBlock, address, event }: { fromBlock: bigint; toBlock: bigint; address: unknown; event: { inputs: unknown[] } }) => {
      if (refuse) throw new Error("fixture provider outage");
      requests.push({ from: fromBlock, through: toBlock, address });
      if (maxLogWidth !== null && toBlock - fromBlock + BigInt(1) > maxLogWidth) throw new Error("logs matched by query exceeds limit of 10000");
      if (mutateDiscovery) {
        mutateDiscovery = false;
        await db.insert(schema.dexPools).values({ ...base, id: ids[1], poolAddress: ids[1], depthUsd: "1" });
      }
      // v3 Swap has seven fields, v4 has eight.
      if (event.inputs.length !== 7 || swapBlock < fromBlock || swapBlock > toBlock) return [];
      return [log(0), log(0), log(1), { ...log(2), address: ids[2], data: "0x" }];
    },
  } as unknown as PublicClient;
  try {
    await db.insert(schema.dexPools).values({ ...base, id: ids[0], poolAddress: ids[0] });
    await db.insert(schema.syncCheckpoints).values({ name: `dex-swaps:${chainId}`, chainId, blockNumber: BigInt(5), blockHash: "legacy-preserved" });
    const first = await scanLiveMarketSwaps(chainId, client, ids);
    assert.equal(first.rows, 2, "overlapping provider logs deduplicate mined identity");
    let metrics = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.chainId, chainId));
    assert.equal(metrics.length, 1, "a pool inserted after enrollment cannot inherit this window, even with backdated firstSeenAt");
    assert.equal(metrics[0].swaps, null, "live-only coverage is incomplete for 24h");
    const [legacy] = await db.select().from(schema.syncCheckpoints).where(eq(schema.syncCheckpoints.name, `dex-swaps:${chainId}`));
    assert.equal(legacy.blockNumber, BigInt(5));
    const backfill = await backfillMarketSwaps(chainId, client, ids);
    assert.equal(backfill.detail?.selectedPools, 1);
    metrics = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.chainId, chainId));
    assert.equal(metrics[0].coverageComplete, true);
    assert.equal(metrics[0].swaps, 2);
    assert.equal(metrics[0].transactions, 1);
    assert.equal(metrics[0].volume0Raw, "4");
    assert.equal(metrics[0].volume1Raw, "6");
    assert.equal(metrics[0].volumeUsd, null, "current price cannot value historical legs");
    const asOf = new Date((origin + Number(head)) * 1000);
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], asOf)).get(ids[0])?.swaps24h, 2);
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], new Date(asOf.getTime() + 120_000))).get(ids[0])?.swaps24h, 2);
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], new Date(asOf.getTime() + 120_001))).get(ids[0])?.swaps24h, null);
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], new Date(asOf.getTime() - 1))).get(ids[0])?.swaps24h, null);
    const sameHead = await scanLiveMarketSwaps(chainId, client, ids);
    assert.equal(sameHead.rows, 0);
    latest += BigInt(100);
    maxLogWidth = BigInt(50);
    await scanLiveMarketSwaps(chainId, client, ids);
    const [narrowed] = await db.select().from(schema.marketSwapIndexState).where(eq(schema.marketSwapIndexState.chainId, chainId));
    assert.equal(narrowed.throughBlock, head + BigInt(50), "a real provider result-cap refusal narrows and commits a contiguous window");
    maxLogWidth = null;
    await scanLiveMarketSwaps(chainId, client, ids);
    metrics = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.chainId, chainId));
    assert.equal(metrics.find((row) => row.poolId === ids[1])?.coverageComplete, false, "late enrolled zero needs its own backfill");
    await backfillMarketSwaps(chainId, client, ids);
    metrics = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.chainId, chainId));
    assert.equal(metrics.find((row) => row.poolId === ids[1])?.swaps, 0);
    const [beforeFailure] = await db.select().from(schema.marketSwapIndexState).where(eq(schema.marketSwapIndexState.chainId, chainId));
    latest += BigInt(100);
    refuse = true;
    await assert.rejects(scanLiveMarketSwaps(chainId, client, ids), /fixture provider outage/);
    const [afterFailure] = await db.select().from(schema.marketSwapIndexState).where(eq(schema.marketSwapIndexState.chainId, chainId));
    assert.equal(afterFailure.throughBlock, beforeFailure.throughBlock);
    refuse = false;
    forkAfter = head - BigInt(500);
    const rewind = await scanLiveMarketSwaps(chainId, client, ids);
    assert.equal(rewind.detail?.reorgRewound, true);
    assert.equal((await db.select().from(schema.marketSwapEvents).where(eq(schema.marketSwapEvents.chainId, chainId))).every((row) => !row.canonical), true);
    await scanLiveMarketSwaps(chainId, client, ids);
    await projectSwapMetrics(chainId, db, ids);
    const events = await db.select().from(schema.marketSwapEvents).where(eq(schema.marketSwapEvents.chainId, chainId));
    assert.equal(events.length, 4, "orphan records survive canonical replay");
    assert.equal(events.filter((row) => row.canonical).length, 2);
    const recoveredMetrics = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.chainId, chainId));
    assert.equal(recoveredMetrics.find((row) => row.poolId === ids[0])?.coverageComplete, true, "adjacent canonical backfill and replay still cover the whole day");
    assert.equal(recoveredMetrics.find((row) => row.poolId === ids[1])?.coverageComplete, false, "a backfill range crossing the fork anchor leaves a real gap until rescanned");
    assert.ok(requests.length < 25, "bounded windows avoid per-event header reads");
    // Statement triggers reject even an UPDATE that matches zero rows. An
    // unchanged admission must not enter either existing-history write path.
    await db.execute(sql`create function pg_temp.reject_swap_history_update() returns trigger language plpgsql as $$
      begin raise exception 'Unchanged enrollment attempted a history update'; end $$;
      create trigger unchanged_enrollment_events before update on market_swap_events for each statement execute function pg_temp.reject_swap_history_update();
      create trigger unchanged_enrollment_ranges before update on market_swap_ranges for each statement execute function pg_temp.reject_swap_history_update()`);
    try {
      await enrollSwapPools(chainId, latest, [ids[0]]);
    } finally {
      await db.execute(sql`drop trigger unchanged_enrollment_events on market_swap_events;
        drop trigger unchanged_enrollment_ranges on market_swap_ranges`);
    }
    await db.update(schema.dexPools).set({ createdBlock: BigInt(2) }).where(eq(schema.dexPools.id, ids[0]));
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], asOf)).has(ids[0]), false, "changed factory provenance cannot inherit old metrics between enrollment runs");
    await enrollSwapPools(chainId, latest, [ids[1]]);
    assert.equal((await readCurrentMarketSwapMetrics(chainId, [ids[0]], asOf)).has(ids[0]), false, "an unselected changed pool remains withheld before targeted re-enrollment");
    await enrollSwapPools(chainId, latest, [ids[0]]);
    const [reenrolled] = await db.select().from(schema.marketPoolSwapMetrics).where(eq(schema.marketPoolSwapMetrics.poolId, ids[0]));
    assert.equal(reenrolled.enrolledFromBlock, latest);
    assert.equal(reenrolled.swaps, null);
    assert.equal((await db.select().from(schema.marketSwapEvents).where(eq(schema.marketSwapEvents.poolId, ids[0]))).some(function canonical(row) { return row.canonical; }), false, "targeted re-enrollment invalidates the prior factory's mined events");
    assert.equal((await db.select().from(schema.marketSwapRanges).where(eq(schema.marketSwapRanges.poolId, ids[0]))).some(function canonical(row) { return row.canonical; }), false, "targeted re-enrollment invalidates its old coverage ranges too");
  } finally {
    for (const table of [schema.marketSwapEvents, schema.marketSwapRanges, schema.marketPoolSwapMetrics, schema.marketSwapIndexState, schema.dexPools, schema.syncCheckpoints]) {
      await db.delete(table).where(eq(table.chainId, chainId));
    }
    await db.delete(schema.syncCheckpointHistory).where(sql`${schema.syncCheckpointHistory.name} like ${`%:${chainId}`}`);
    await close();
  }
});
