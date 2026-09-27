import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("new-pool subscriptions drain later launches and keep unpriced facts null", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function subscriptions(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, watchers, watcherDeliveries, dexPools, dexTokens, registryAssets, lookalikeTokens } = await import("@/lib/db/schema");
  const { matchNewPools } = await import("@/lib/watch/new-pools");
  const { getAssetBySymbol } = await import("@/lib/registry/assets");
  const chainId = 777331;
  const owner = randomUUID();
  const all = randomUUID();
  const lookalikes = randomUUID();
  const priced = randomUUID();
  const verifiedAddress = `0x${"a".repeat(40)}`;
  const assetId = `${chainId}:${verifiedAddress}`;
  const launched = new Date();
  const poolIds = Array.from({ length: 45 }, () => `pool_${randomUUID()}`);
  const addresses = poolIds.map((_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`);

  try {
    await db.insert(user).values({ id: owner });
    await db.insert(registryAssets).values({
      id: assetId, chainId, address: verifiedAddress, symbol: "cbBTC", name: "Listed Bitcoin",
      decimals: 8, assetType: "bridged", source: "test", verifiedAt: launched,
      onchainSymbol: "cbBTC", onchainDecimals: 8,
    });
    await db.insert(watchers).values([
      { id: all, userId: owner, name: "All", kind: "new_pool", chainId, address: "", threshold: "0", lastCheckedBlock: BigInt(100), createdAt: new Date(launched.getTime() - 1000) },
      { id: lookalikes, userId: owner, name: "Lookalikes", kind: "new_pool", chainId, address: "", threshold: "0", lastCheckedBlock: BigInt(100), lookalikesOnly: true, createdAt: new Date(launched.getTime() - 1000) },
      { id: priced, userId: owner, name: "Priced", kind: "new_pool", chainId, address: "", threshold: "100", lastCheckedBlock: BigInt(100), createdAt: new Date(launched.getTime() - 1000) },
    ]);
    await db.insert(dexTokens).values(addresses.map((address, index) => ({
      id: `${chainId}:${address}`, chainId, address, symbol: index === 25 ? "cbBTC" : `MEME${index}`,
      name: `Community fixture ${index}`, decimals: 18, bytecodePresent: true, checkedAt: launched,
    })));
    await db.insert(dexPools).values(poolIds.map((id, index) => ({
      id, chainId, venue: "uniswap_v3", poolAddress: addresses[index],
      currency0: addresses[index], currency1: verifiedAddress, fee: 3000, tickSpacing: 60,
      hooks: `0x${"0".repeat(40)}`, tokenAddress: addresses[index], quoteAssetId: assetId,
      createdBlock: BigInt(index + 101), firstSeenAt: new Date(launched.getTime() + index),
      priceUsd: null, depthUsd: null, stateCheckedAt: null,
    })));
    await db.insert(dexPools).values({
      id: `historical_${randomUUID()}`, chainId, venue: "uniswap_v3",
      currency0: addresses[0], currency1: verifiedAddress, fee: 3000, tickSpacing: 60,
      hooks: `0x${"0".repeat(40)}`, tokenAddress: addresses[0], createdBlock: BigInt(50),
      firstSeenAt: launched,
    });
    await db.insert(lookalikeTokens).values({
      id: randomUUID(), chainId, address: addresses[25], symbol: "cbBTC",
      matchesAssetId: assetId, matchesSymbol: "cbBTC", kind: "unlisted_stock",
    });

    await t.test("mixed-case listed symbols resolve without changing their canonical spelling", async function symbols() {
      for (const symbol of ["cbBTC", "CBBTC", "cbbtc"]) {
        assert.equal((await getAssetBySymbol(chainId, symbol))?.symbol, "cbBTC");
      }
    });
    await matchNewPools(chainId);
    let alerts = await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, all));
    assert.equal(alerts.length, 20);
    const payload = alerts[0].payload as { priceUsd: unknown; depthUsd: unknown; trust: { level: string } };
    assert.equal(payload.priceUsd, null);
    assert.equal(payload.depthUsd, null);
    assert.equal(payload.trust.level, "community");
    const warnings = await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, lookalikes));
    assert.equal(warnings.length, 1, "historical beacon classifications cannot bypass lookalike-only subscriptions");
    const warning = warnings[0].payload as { trust: { level: string; impersonates: { address: string } } };
    assert.equal(warning.trust.level, "lookalike");
    assert.equal(warning.trust.impersonates.address, verifiedAddress);
    assert.equal((await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, priced))).length, 0);

    await matchNewPools(chainId);
    alerts = await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, all));
    assert.equal(alerts.length, 40);
    await matchNewPools(chainId);
    await matchNewPools(chainId);
    alerts = await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.watcherId, all));
    assert.equal(alerts.length, 45);
    assert.equal(new Set(alerts.map((alert) => alert.txHash)).size, 45);
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(lookalikeTokens).where(eq(lookalikeTokens.chainId, chainId));
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});
