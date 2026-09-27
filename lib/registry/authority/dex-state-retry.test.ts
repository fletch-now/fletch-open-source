import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import { stateRetryIsDue, STATE_RETRY_MAX_MS } from "./dex-state-retry";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("state retry dates accept due work and recover invalid future timestamps", function retry() {
  const now = new Date("2026-09-08T00:00:00Z");
  assert.equal(stateRetryIsDue(new Date(now.getTime() + 60_000), now), false);
  for (const value of [null, new Date(0), new Date("invalid"), new Date(now.getTime() + STATE_RETRY_MAX_MS + 1)]) {
    assert.equal(stateRetryIsDue(value, now), true);
  }
});

test("a failed v3 reserve read keeps prior evidence and backs off while another pool advances", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function reserves() {
  const { db, close } = await import("@/lib/db");
  const { dexPools, registryAssets, registryAssetState } = await import("@/lib/db/schema");
  const { refreshPoolState } = await import("./dex");
  const { duePoolStateReads } = await import("./dex-state-schedule");
  const chainId = 777371;
  const quote = `0x${"7".repeat(40)}`;
  const quoteId = `${chainId}:${quote}`;
  const ids = [1, 2].map((n) => `0x${(77737100 + n).toString(16).padStart(40, "0")}`);
  const observed = new Date(Date.now() - 700_000);
  let failed = true;
  let calls = 0;
  const client = { multicall: async ({ contracts }: { contracts: Array<{ functionName: string; args?: unknown[] }> }) => {
    calls++;
    return contracts.map((contract) => {
      if (contract.functionName === "slot0") return { status: "success", result: [BigInt(2) ** BigInt(96), 0, 0, 0] };
      if (contract.functionName === "liquidity") return { status: "success", result: BigInt(1_000_000) };
      assert.equal(contract.functionName, "balanceOf");
      assert.ok(ids.includes(String(contract.args?.[0])), "v3 reserves read each pool's own balance; no v4 manager fallback");
      if (failed && contract.args?.[0] === ids[0]) return { status: "failure" };
      return { status: "success", result: BigInt(234_567_891) };
    });
  } } as unknown as PublicClient;
  try {
    await db.insert(registryAssets).values({ id: quoteId, chainId, address: quote, symbol: "USDG", name: "Fixture quote", assetType: "stablecoin", decimals: 6, source: "fixture" });
    await db.insert(dexPools).values(ids.map((id) => ({ id, chainId, venue: "uniswap_v3", poolAddress: id, currency0: `0x${"1".repeat(40)}`, currency1: quote,
      quoteAssetId: quoteId, fee: 3000, tickSpacing: 60, hooks: `0x${"0".repeat(40)}`, createdBlock: BigInt(1), stateCheckedAt: observed, depthUsd: "999", priceUsd: "2" })));
    await refreshPoolState(chainId, { poolIds: ids, client });
    const [first] = await db.select().from(dexPools).where(eq(dexPools.id, ids[0]));
    const [second] = await db.select().from(dexPools).where(eq(dexPools.id, ids[1]));
    assert.equal(first.stateCheckedAt?.getTime(), observed.getTime());
    assert.equal(first.depthUsd, "999");
    assert.equal(first.priceUsd, "2");
    assert.equal(first.stateFailures, 1);
    assert.ok(first.stateRetryAt && first.stateRetryAt.getTime() > Date.now());
    assert.equal(second.depthUsd, "234.57");
    assert.ok(second.stateCheckedAt && second.stateCheckedAt > observed);
    assert.equal(second.stateFailures, 0);
    assert.equal((await duePoolStateReads(chainId)).length, 0, "retrying failure and current success cannot monopolize another background batch");
    const previousCalls = calls;
    await refreshPoolState(chainId, { poolIds: ids, client });
    assert.equal(calls, previousCalls, "restart or repeated demand honors persisted backoff");
    await db.update(dexPools).set({ stateRetryAt: new Date(0) }).where(eq(dexPools.id, ids[0]));
    failed = false;
    await refreshPoolState(chainId, { poolIds: [ids[0]], client });
    const [recovered] = await db.select().from(dexPools).where(eq(dexPools.id, ids[0]));
    assert.equal(recovered.stateFailures, 0);
    assert.equal(recovered.stateRetryAt, null);
    assert.equal(recovered.depthUsd, "234.57");
    assert.ok(recovered.stateCheckedAt && recovered.stateCheckedAt > observed);
    await db.update(registryAssets).set({ assetType: "wrapped_native" }).where(eq(registryAssets.id, quoteId));
    await db.insert(registryAssetState).values({ assetId: quoteId, chainId, address: quote, feedPrice: "4000", feedCheckedAt: observed, feedStale: false });
    await refreshPoolState(chainId, { poolIds: [ids[0]], client, force: true });
    const [staleQuote] = await db.select().from(dexPools).where(eq(dexPools.id, ids[0]));
    assert.equal(staleQuote.depthUsd, null, "a fresh pool read cannot renew a stale quote's dollar value");
    await db.update(registryAssetState).set({ feedCheckedAt: new Date() }).where(eq(registryAssetState.assetId, quoteId));
    await refreshPoolState(chainId, { poolIds: [ids[0]], client, force: true });
    const [currentQuote] = await db.select().from(dexPools).where(eq(dexPools.id, ids[0]));
    assert.equal(currentQuote.depthUsd, "938271.56");
  } finally {
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(registryAssets).where(eq(registryAssets.chainId, chainId));
    await close();
  }
});
