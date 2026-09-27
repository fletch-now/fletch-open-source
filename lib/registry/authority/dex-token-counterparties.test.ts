import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

function address(n: number): string {
  return `0x${n.toString(16).padStart(40, "0")}`;
}

test("metadata admission follows both factory currencies and prioritizes traded stock counterparties", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function admission() {
  const { db, close } = await import("@/lib/db");
  const { dexPools, dexTokens, registryAssets } = await import("@/lib/db/schema");
  const { dueTokenReads, tokenMetadataBacklog } = await import("./dex-token-queue");
  const chainId = 777367;
  const now = new Date("2026-09-08T12:00:00Z");
  const stock = address(1001);
  const old = new Date("2026-09-01T00:00:00Z");
  try {
    await db.insert(registryAssets).values({ id: `${chainId}:stock`, chainId, address: stock, symbol: "STOCK",
      name: "Stock", assetType: "stock_token", source: "fixture", decimals: 18, status: "active",
      verifiedAt: now, onchainSymbol: "STOCK", onchainDecimals: 18 });
    const pairs = [
      { currency0: stock, currency1: address(101), tier: "active", lastSwapAt: now },
      { currency0: address(102), currency1: stock, tier: "active", lastSwapAt: now },
      { currency0: stock, currency1: address(103), tier: "dormant", lastSwapAt: now },
      { currency0: stock, currency1: address(104), tier: "dormant", lastSwapAt: null },
      { currency0: address(105), currency1: address(106), tier: "active", lastSwapAt: null },
      { currency0: address(0), currency1: address(107), tier: "active", lastSwapAt: null },
      { currency0: stock, currency1: address(108), tier: "active", lastSwapAt: now, canonical: false },
      { currency0: stock, currency1: address(109), tier: "dormant", lastSwapAt: old },
    ];
    await db.insert(dexPools).values(pairs.map((pair, index) => ({ ...pair, id: `${chainId}:pool:${index}`,
      chainId, tokenAddress: null, fee: 3000, tickSpacing: 60, hooks: address(0), createdBlock: BigInt(index + 1), firstSeenAt: old })));
    const batch = await dueTokenReads(chainId, now, null, 4, true);
    assert.deepEqual(batch.slice(0, 3), [address(101), address(102), address(103)], "both stock orientations and a recent trade outrank untraded pools");
    const all = await dueTokenReads(chainId, now, null, 12, true);
    assert.deepEqual(new Set(all), new Set([101, 102, 103, 105, 106, 107].map(address)), "both community currencies enter even without token_address; native, listed, dormant junk and withdrawn pools stay out");
    const backlog = await tokenMetadataBacklog(chainId, now, null, true);
    assert.equal(backlog.total, 6);
    assert.equal(backlog.neverRead, 6);
    assert.ok(all.includes(address(105)) && all.includes(address(106)));
    await db.insert(dexTokens).values({ id: `${chainId}:${address(104)}`, chainId, address: address(104), checkedAt: null });
    assert.ok(!(await dueTokenReads(chainId, now, null, 12)).includes(address(104)), "a dormant counterpart cannot re-enter through the standalone metadata lane");
    await db.update(registryAssets).set({ onchainDecimals: 6 }).where(eq(registryAssets.chainId, chainId));
    assert.ok(!(await dueTokenReads(chainId, now, null, 12, true)).includes(address(103)), "metadata-mismatched listings do not give dormant contracts verified-stock priority");
    await db.update(registryAssets).set({ onchainDecimals: 18 }).where(eq(registryAssets.chainId, chainId));
    await db.insert(dexPools).values([
      { id: `${chainId}:oldest`, chainId, currency0: address(0), currency1: address(1), tier: "quiet", fee: 3000, tickSpacing: 60, hooks: address(0), createdBlock: BigInt(1), firstSeenAt: old },
      ...[400, 401, 402].map((n) => ({ id: `${chainId}:new:${n}`, chainId, currency0: address(0), currency1: address(n), tier: "active", fee: 3000, tickSpacing: 60, hooks: address(0), createdBlock: BigInt(1400-n), firstSeenAt: now })),
    ]);
    const freshBatch = await dueTokenReads(chainId, now, null, 4, true);
    assert.deepEqual(freshBatch, [400, 101, 102, 1].map(address), "newest factory currency, active stock counterparties and oldest backlog share four slots");
    assert.equal(new Set(freshBatch).size, freshBatch.length, "overlapping lanes do not repeat a read");
    const firstSlots = [];
    for (let minute = 0; minute < 4; minute++) {
      firstSlots.push((await dueTokenReads(chainId, new Date(now.getTime()+minute*60_000), null, 1, true))[0]);
    }
    assert.ok(firstSlots.includes(address(400)) && firstSlots.includes(address(1)), "one-read deadlines still reach new and old contracts over four minutes");
    await db.insert(dexTokens).values({ id: `${chainId}:${address(400)}`, chainId, address: address(400), checkedAt: now });
    assert.equal((await dueTokenReads(chainId, now, null, 4, true))[0], address(401), "saved metadata advances the discovery lane after a restart");
  } finally {
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});
