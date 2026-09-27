import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("market rows and ordering use the same complete current projection and preserve exact address lookup", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function markets() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { dexPools, marketPoolSwapMetrics, marketSwapIndexState } = await import("@/lib/db/schema");
  const { dexPoolsPage, searchShapeOf } = await import("./dex");
  const { readSwapIndexer } = await import("./market-swap-status");
  const { publicPool } = await import("./shape");
  const chainId = 777339;
  const address = `0x${"3".repeat(40)}`;
  const now = new Date();
  const windowStart = new Date(now.getTime() - 86_400_000);
  const values = [
    { suffix: "a", depthUsd: "200", volume: "900", swaps: 2, createdBlock: BigInt(3) },
    { suffix: "b", depthUsd: "400", volume: "500", swaps: 9, createdBlock: BigInt(1) },
    { suffix: "c", depthUsd: "300", volume: null, swaps: null, createdBlock: BigInt(5) },
    { suffix: "d", depthUsd: "300", volume: null, swaps: null, createdBlock: BigInt(5) },
    { suffix: "dust", depthUsd: null, volume: null, swaps: null, createdBlock: BigInt(9) },
  ];
  const base = { stateCheckedAt: now, chainId, venue: "uniswap_v3", currency0: address, currency1: `0x${"4".repeat(40)}`, fee: 3000, tickSpacing: 60, hooks: `0x${"0".repeat(40)}`, tokenAddress: address };
  const query = { chainId, kind: "all" as const, tier: "active" as const, limit: 10, offset: 0, venue: null, q: null, floorUsd: 100 };
  try {
    await db.insert(dexPools).values(values.map((row) => ({ ...base, depthUsd: row.depthUsd, createdBlock: row.createdBlock, id: `${chainId}_${row.suffix}`, volumeUsd24h: "999999999", swaps24h: 9999 })));
    let progress = await readSwapIndexer(chainId, now);
    assert.equal(progress.newestCountedBlock, null);
    assert.deepEqual(progress.tiers.find((tier) => tier.tier === "active"), { tier: "active", totalPools: 5, enrolledPools: 0, complete24hPools: 0 });
    await db.insert(marketSwapIndexState).values({ chainId, liveStartBlock: BigInt(10), liveStartAt: now, throughBlock: BigInt(100), throughAt: now, throughHash: "fixture", windowStartBlock: BigInt(1), windowStartAt: windowStart });
    await db.insert(marketPoolSwapMetrics).values(values.map((row) => ({ chainId, poolId: `${chainId}_${row.suffix}`, enrolledFromBlock: BigInt(10), coveredFromBlock: BigInt(1), factoryCreatedBlock: row.createdBlock, coverageComplete: row.swaps !== null, swaps: row.swaps, transactions: row.swaps, volumeUsd: row.volume, volume0Raw: row.swaps === null ? null : "123", volume1Raw: row.swaps === null ? null : "456" })));
    const expected = { volume: ["a", "b", "c", "d"], depth: ["b", "c", "d", "a"], swaps: ["b", "a", "c", "d"], newest: ["c", "d", "a", "b"] };
    for (const sort of ["volume", "depth", "swaps", "newest"] as const) {
      const result = await dexPoolsPage({ ...query, sort }, async () => []);
      assert.equal(result.total, 4);
      assert.deepEqual(result.pools.map((pool) => pool.id), expected[sort].map((suffix) => `${chainId}_${suffix}`));
      assert.notEqual(result.pools[0].swaps24h, 9999, "legacy daily counts cannot leak into rolling metrics");
    }
    const pasted = await dexPoolsPage({ ...query, sort: "newest", q: address }, async () => []);
    assert.equal(pasted.total, 5);
    assert.equal(pasted.pools[0].id, `${chainId}_dust`);
    const active = (await dexPoolsPage({ ...query, sort: "volume" }, async () => [])).pools[0];
    assert.equal(publicPool(active, new Map(), undefined, 0, now.getTime()).volume0Raw, "123");
    assert.equal(publicPool(active, new Map(), undefined, 0, now.getTime() + 120_001).swaps24h, null, "serialization checks expiry again");
    await db.update(marketPoolSwapMetrics).set({ coverageComplete: false }).where(eq(marketPoolSwapMetrics.poolId, `${chainId}_a`));
    const gap = await dexPoolsPage({ ...query, sort: "volume" }, async () => []);
    assert.deepEqual(gap.pools.map((pool) => pool.id), ["b", "a", "c", "d"].map((suffix) => `${chainId}_${suffix}`), "missing volume has stable identity order and never falls back to depth");
    assert.equal(gap.pools[3].volumeUsd24h, null);
    await db.update(marketSwapIndexState).set({ throughAt: new Date(now.getTime() - 121_000) }).where(eq(marketSwapIndexState.chainId, chainId));
    const expired = await dexPoolsPage({ ...query, sort: "volume" }, async () => []);
    assert.ok(expired.pools.every((pool) => pool.swaps24h === null && pool.volume0Raw === null));
    progress = await readSwapIndexer(chainId, now);
    assert.equal(progress.current, false);
    assert.equal(progress.lagSeconds, 121);
    assert.equal(progress.tiers.find((tier) => tier.tier === "active")?.complete24hPools, 1, "coverage count retains its old window with explicit current=false");
    await db.update(dexPools).set({ stateCheckedAt: new Date(now.getTime() - 600_001), depthUsd: "99999999" }).where(eq(dexPools.id, `${chainId}_b`));
    const staleDepth = await dexPoolsPage({ ...query, sort: "depth" }, async () => []);
    assert.equal(staleDepth.pools.some(pool => pool.id === `${chainId}_b`), false, "stale depth cannot satisfy a positive depth floor");
    const allDepth = await dexPoolsPage({ ...query, tier: "all", sort: "depth" }, async () => []);
    assert.ok(allDepth.pools.findIndex(pool => pool.id === `${chainId}_b`) > allDepth.pools.findIndex(pool => pool.id === `${chainId}_a`), "stale depth sorts after current observations in the archive view");
    assert.equal(searchShapeOf(address), "address");
    assert.equal(searchShapeOf(`0x${"a".repeat(64)}`), "poolId");
  } finally {
    await db.delete(marketPoolSwapMetrics).where(eq(marketPoolSwapMetrics.chainId, chainId));
    await db.delete(marketSwapIndexState).where(eq(marketSwapIndexState.chainId, chainId));
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await close();
  }
});
