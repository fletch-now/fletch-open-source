import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("pool range replay emits community discoveries once and excludes other windows and withdrawn pools", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function replay() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { dexPools, dexTokens, authorityEvents } = await import("@/lib/db/schema");
  const { announceNewPools } = await import("./dex");
  const chainId = 777361;
  const address = `0x${"6".repeat(40)}`;
  const now = new Date();
  try {
    await db.insert(dexTokens).values({ id: randomUUID(), chainId, address, symbol: "FRONG", name: "Frong", decimals: 18, checkedAt: now, bytecodePresent: true });
    for (const block of [9, 10, 11, 12]) await db.insert(dexPools).values({ id: randomUUID(), chainId, venue: "uniswap_v4", currency0: address, currency1: `0x${"7".repeat(40)}`, tokenAddress: address, fee: 3000, tickSpacing: 60, hooks: `0x${"0".repeat(40)}`, createdBlock: BigInt(block), canonical: block !== 11 });
    await announceNewPools(chainId, "uniswap_v4", BigInt(10), BigInt(11), new Map());
    await announceNewPools(chainId, "uniswap_v4", BigInt(10), BigInt(11), new Map());
    const rows = await db.select().from(authorityEvents).where(eq(authorityEvents.chainId, chainId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].kind, "dex.pool_new");
    assert.equal(rows[0].symbol, "FRONG");
    assert.equal(rows[0].assetId, null);
    assert.equal((rows[0].detail as Record<string, unknown>).tokenAddress, address);
    assert.match(rows[0].title, /FRONG/);
  } finally {
    await db.delete(authorityEvents).where(eq(authorityEvents.chainId, chainId));
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await close();
  }
});
