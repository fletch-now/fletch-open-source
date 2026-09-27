import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("latest feed rounds require positive completed answers and valid source times", async function () {
  const { validLatestRound } = await import("./feeds");
  const valid = [BigInt(2), BigInt(100), BigInt(0), BigInt(1000), BigInt(2)];
  assert.ok(validLatestRound(valid, 1000), "a zero unused startedAt is allowed");
  for (const [index, value] of [[0, 0], [1, 0], [1, -1], [2, 1001], [3, 0], [3, 1001], [4, 1]]) {
    const invalid = [...valid]; invalid[index] = BigInt(value);
    assert.equal(validLatestRound(invalid, 1000), null);
  }
  assert.equal(validLatestRound([2, 100, 0, 1000, 2], 1000), null);
  assert.equal(validLatestRound(valid.slice(0, 4), 1000), null);
});

test("feed failures preserve source identity and ages while successful reads use each directory heartbeat", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  const { db, close } = await import("@/lib/db");
  const { registryAssets, registryAssetState, feedRounds, authorityEvents } = await import("@/lib/db/schema");
  const { refreshFeeds } = await import("./feeds");
  const chainId = 777392;
  const now = new Date("2026-09-10T21:00:00Z");
  const seconds = Math.floor(now.getTime() / 1000);
  const address = (n: number): `0x${string}` => `0x${n.toString(16).padStart(40, "0")}`;
  const feeds = Array.from({ length: 5 }, (_, index) => ({ symbol: `F${index}`, address: address(index + 1), decimals: 8, heartbeatSeconds: index === 2 ? 60 : null }));
  try {
    await db.insert(registryAssets).values(feeds.map((feed, index) => ({ id: `${chainId}:${index}`, chainId, address: address(index + 100), symbol: feed.symbol, name: feed.symbol, assetType: "stock_token", source: "fixture", decimals: 18 })));
    await db.insert(registryAssetState).values([0, 4].map((index) => ({ assetId: `${chainId}:${index}`, chainId, address: address(index + 100),
      feedAddress: index === 0 ? address(99) : feeds[index].address, feedPrice: "12", feedStale: false,
      feedUpdatedAt: new Date(now.getTime() - 120_000), feedCheckedAt: new Date(now.getTime() - 120_000) })));
    const previous = await db.select().from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
    const client = { multicall: async () => feeds.map((_, index) => {
      if (index === 0) return { status: "failure", error: new Error("RPC unavailable") };
      const answer = index === 1 ? BigInt(0) : BigInt(250000000);
      const at = index === 4 ? seconds + 1 : seconds - 61;
      return { status: "success", result: [BigInt(2), answer, BigInt(0), BigInt(at), BigInt(2)] };
    }) } as unknown as PublicClient;
    const outcome = await refreshFeeds(chainId, { client, feeds, now: () => now });
    assert.equal(outcome.rows, 2);
    assert.match(outcome.error ?? "", /3 feed reads failed or returned invalid rounds/);
    const saved = await db.select().from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
    for (const old of previous) assert.deepEqual(saved.find((row) => row.assetId === old.assetId), old, "failed transport and future rounds preserve every stored source field");
    assert.equal(saved.find((row) => row.assetId === `${chainId}:2`)?.feedStale, true, "published sixty-second heartbeat expires the sixty-one-second answer");
    assert.equal(saved.find((row) => row.assetId === `${chainId}:3`)?.feedStale, false, "missing heartbeat uses the documented fallback");
    assert.equal(saved.find((row) => row.assetId === `${chainId}:3`)?.feedPrice, "2.50000000");
    const rounds = await db.select().from(feedRounds).where(eq(feedRounds.chainId, chainId));
    assert.equal(rounds.length, 2, "invalid rounds never enter historical prices");
    assert.deepEqual((outcome.detail?.metricCoverage as Record<string, unknown>).oraclePrice, {
      eligible: 5, current: 2, failed: 3, unread: 1, oldestInputAgeSeconds: 120, measuredAt: now.toISOString(),
    });
  } finally {
    await db.delete(feedRounds).where(eq(feedRounds.chainId, chainId));
    await db.delete(authorityEvents).where(eq(authorityEvents.chainId, chainId));
    await db.delete(registryAssetState).where(eq(registryAssetState.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});
