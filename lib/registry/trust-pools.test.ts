import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("pool and token identity share one verdict including normalized collisions", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { registryAssets, dexTokens } = await import("@/lib/db/schema");
  const { trustForToken, trustForPools } = await import("./trust");
  const chainId = 779955;
  const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
  const assets = [
    { id: `${chainId}:verified`, chainId, address: address(1), symbol: "TSLA", name: "Tesla", assetType: "stock_token", source: "test", decimals: 18, verifiedAt: new Date(), onchainSymbol: "TSLA", onchainDecimals: 18 },
    { id: `${chainId}:listed`, chainId, address: address(2), symbol: "PENDING", name: "Pending", assetType: "stock_token", source: "test", decimals: 18 },
  ];
  try {
    await db.insert(registryAssets).values(assets);
    await db.insert(dexTokens).values([
      { id: `${chainId}:3`, chainId, address: address(3), name: "Other name", symbol: "ТSLA", decimals: 18, bytecodePresent: true },
      { id: `${chainId}:4`, chainId, address: address(4), name: "Community sample", symbol: "EXAMPLE", decimals: 18, bytecodePresent: true },
    ]);
    const pools = [1, 2, 3, 4, 5].map((n) => ({ id: String(n), assetId: n <= 2 ? assets[n - 1].id : null, tokenAddress: n > 2 ? address(n) : null }));
    const identities = await trustForPools(chainId, pools, assets);
    const expected = ["verified", "listed", "lookalike", "community", "unknown"];
    for (const [index, candidate] of pools.entries()) {
      const token = await trustForToken(chainId, address(index + 1));
      assert.equal(token.level, expected[index]);
      assert.equal(identities.get(candidate.id)?.level, token.level);
      assert.equal(identities.get(candidate.id)?.address, address(index + 1));
    }
    assert.equal(identities.get("3")?.impersonates?.address, address(1));
  } finally {
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});
