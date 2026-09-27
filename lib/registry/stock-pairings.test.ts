import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("stock pairing verdict follows each stock-side address, including same-ticker memes", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function pairings(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { registryAssets, dexTokens, dexPools } = await import("@/lib/db/schema");
  const { readStockPairings, readStockPairingPage, readStockPairingSummaries } = await import("./stock-pairings");
  const chainId = 777360;
  const stock = `0x${"1".repeat(40)}`;
  const lookalike = `0x${"2".repeat(40)}`;
  const meme = `0x${"3".repeat(40)}`;
  const unread = `0x${"4".repeat(40)}`;
  const now = new Date();
  try {
    await db.insert(registryAssets).values({ id: randomUUID(), chainId, address: stock, symbol: "TSLA", name: "Tesla", decimals: 18, assetType: "stock_token", source: "fixture", verifiedAt: now, onchainSymbol: "TSLA", onchainDecimals: 18 });
    await db.insert(dexTokens).values([
      { id: randomUUID(), chainId, address: lookalike, symbol: "TSLA", name: "Tesla meme", decimals: 18, bytecodePresent: true, checkedAt: now },
      { id: randomUUID(), chainId, address: meme, symbol: "CYBERTRUCK", name: "Cybertruck", decimals: 18, bytecodePresent: true, checkedAt: now },
    ]);
    for (const [left, right] of [[stock, meme], [lookalike, meme], [stock, lookalike], [stock, unread]]) await db.insert(dexPools).values({ id: randomUUID(), chainId, venue: "uniswap_v4", currency0: left, currency1: right, fee: 3000, tickSpacing: 60, hooks: `0x${"0".repeat(40)}`, createdBlock: BigInt(1) });
    const firstPool = randomUUID();
    await db.insert(dexPools).values({ id: firstPool, chainId, venue: "uniswap_v4", currency0: stock, currency1: meme, fee: 500, tickSpacing: 10, hooks: `0x${"0".repeat(40)}`, createdBlock: BigInt(2), lastSwapAt: now });
    const rows = await readStockPairings(chainId);
    assert.ok(rows.some((row) => row.stockAddress === stock && row.stockVerdict === "canonical" && row.communityAddress === meme));
    assert.ok(rows.some((row) => row.stockAddress === lookalike && row.stockVerdict === "lookalike" && row.canonicalAddress === stock));
    assert.ok(rows.some((row) => row.stockAddress === stock && row.communityAddress === lookalike));
    assert.ok(rows.some((row) => row.communityAddress === unread && row.communitySymbol === null && row.observedAt === null && row.stockVerdict === "canonical"), "new pair remains visible while metadata is queued");
    const summary = (await readStockPairingSummaries(chainId, [stock])).get(stock)!;
    assert.equal(summary.summary.totalPools, 5);
    assert.equal(summary.summary.counterparties, 3);
    assert.equal(summary.summary.resolvedCounterparties, 2);
    assert.equal(summary.summary.pendingCounterparties, 1);
    assert.equal(summary.summary.observedSwapPools, 1);
    assert.equal(summary.items.length, 3);
    assert.equal(summary.items[0].poolId, firstPool, "recorded swap ranks before unread factory discoveries");
    assert.equal(summary.items[0].communityName, "Cybertruck");
    assert.equal(summary.items[0].metadataStatus, "current");
    assert.equal(summary.items.filter((row) => row.stockAddress === stock && row.communityAddress === meme).length, 1, "summary groups fee-tier pools for each contract pair");
    t.mock.method(Date, "now", () => now.getTime()+2000);
    const reused=(await readStockPairingSummaries(chainId,[stock])).get(stock)!;
    assert.equal(reused.summary.asOf,summary.summary.asOf,"summary cache retains its original measurement time");
    assert.equal(reused.items[0].observedAt,summary.items[0].observedAt);
    assert.equal(reused.items[0].metadataAgeSeconds,2,"cached metadata age is recomputed at response time");
    t.mock.restoreAll();
    const all: string[] = [];
    let offset = 0;
    while (true) {
      const page = await readStockPairingPage(chainId, { address: stock, limit: 2, offset });
      assert.equal(page.total, 5);
      all.push(...page.items.map((item) => item.id));
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    assert.equal(all.length, 5);
    assert.equal(new Set(all).size, 5);
    assert.equal((await readStockPairingPage(chainId, { address: unread, limit: 2, offset: 0 })).total, 1, "community addresses are independently filterable");
    const beyond = await readStockPairingPage(chainId, { address: stock, limit: 2, offset: 100 });
    assert.equal(beyond.total, 5);
    assert.deepEqual(beyond.items, []);
    assert.equal(beyond.nextOffset, null);
    await db.insert(dexPools).values(Array.from({ length: 1005 }, (_, index) => ({ id: randomUUID(), chainId, venue: "uniswap_v4", currency0: stock, currency1: unread, fee: index + 1, tickSpacing: 10, hooks: `0x${"0".repeat(40)}`, createdBlock: BigInt(index + 3) })));
    const tail = await readStockPairingPage(chainId, { address: stock, limit: 100, offset: 1000 });
    assert.equal(tail.total, 1010);
    assert.equal(tail.items.length, 10, "all factory pools remain available beyond the former global 1000-row cap");
    assert.equal(tail.nextOffset, null);
  } finally {
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});


test("pairing query rejects invalid addresses and unbounded pagination", async function parameters() {
  const { stockPairingQuery } = await import("./stock-pairings");
  for (const query of ["address=NVDA", "limit=101", "limit=0", "offset=-1", "offset=1.2", "q=NVDA", "limit=2&limit=3"]) assert.throws(() => stockPairingQuery(new URLSearchParams(query)));
  assert.deepEqual(stockPairingQuery(new URLSearchParams()), { address: undefined, limit: 50, offset: 0 });
});


test("pair metadata age and failed observations remain explicit without inferred activity", async function metadata() {
  const { pairingFromRow } = await import("./stock-pairings");
  const now = Date.parse("2026-09-14T00:00:00Z");
  const row = { id: "pool", venue: "uniswap_v4", stock: "stock", community: "community", symbol: "NVDA", canonical_address: "stock", community_symbol: null, community_name: null, metadata_error: null, observed_at: null, last_swap_at: null, created_block: "1" };
  assert.equal(pairingFromRow(row, now).metadataStatus, "pending");
  assert.equal(pairingFromRow(row, now).lastSwapAt, null);
  const known = { ...row, community_symbol: "FRONG", community_name: "Frong", observed_at: "2026-09-13T23:59:50Z" };
  assert.equal(pairingFromRow(known, now).metadataStatus, "current");
  assert.equal(pairingFromRow(known, now).metadataAgeSeconds, 10);
  assert.equal(pairingFromRow({ ...known, metadata_error: "RPC unavailable" }, now).metadataStatus, "failed");
  assert.equal(pairingFromRow({ ...known, observed_at: "2026-09-12T00:00:00Z" }, now).metadataStatus, "stale");
});
