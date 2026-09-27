import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("market demand persists deduplication, retry leases and shared admission limits", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  const { db, close } = await import("@/lib/db");
  const { dexPools, dexTokens, marketRefreshRequests } = await import("@/lib/db/schema");
  const { enqueueMarketRefresh, enqueueMarketSearch, claimMarketRefresh, finishMarketRefresh, refreshRetryMs } = await import("./market-refresh");
  const chainId = 777369;
  const address = "0x139ea209a647fd1f8bf275b982d3dbad3e4b1a4d";
  const poolId = `${chainId}:demand`;
  try {
    await db.execute(sql`delete from rate_counters where bucket like 'market-refresh:%'`);
    await db.insert(dexPools).values({ id: poolId, chainId, currency0: address, currency1: "0x0000000000000000000000000000000000000002", tokenAddress: address,
      fee: 3000, tickSpacing: 60, hooks: "0x0000000000000000000000000000000000000000", createdBlock: BigInt(1), tier: "dormant", depthUsd: "0.15" });
    const unknown = await enqueueMarketSearch(chainId, address, "192.0.2.31");
    assert.equal(unknown.queued, 2, "a dormant known pool and its unread token both enter on demand");
    const [token] = await db.select().from(dexTokens).where(eq(dexTokens.chainId, chainId));
    assert.equal(token.name, null, "a pasted address cannot invent metadata");
    assert.equal(token.checkedAt, null);
    assert.equal((await enqueueMarketSearch(chainId, address, "192.0.2.31")).queued, 0);
    const claims = await Promise.all([claimMarketRefresh(chainId, "pool"), claimMarketRefresh(chainId, "pool")]);
    assert.equal(claims.filter(Boolean).length, 1, "concurrent workers claim a target only once");
    const first = claims.find((claim) => claim !== null)!;
    assert.equal(await finishMarketRefresh(first, false), true);
    const [failed] = await db.select().from(marketRefreshRequests).where(eq(marketRefreshRequests.id, first.id));
    assert.equal(failed.attempts, 1);
    await enqueueMarketSearch(chainId, address, "192.0.2.32");
    const [repeated] = await db.select().from(marketRefreshRequests).where(eq(marketRefreshRequests.id, first.id));
    assert.equal(repeated.nextAttemptAt.getTime(), failed.nextAttemptAt.getTime(), "views cannot reset persisted RPC backoff");
    assert.equal(await claimMarketRefresh(chainId, "pool"), null);
    await db.update(marketRefreshRequests).set({ nextAttemptAt: new Date(0) }).where(eq(marketRefreshRequests.id, first.id));
    const second = (await claimMarketRefresh(chainId, "pool"))!;
    await db.update(marketRefreshRequests).set({ leaseUntil: new Date(0) }).where(eq(marketRefreshRequests.id, first.id));
    const restarted = (await claimMarketRefresh(chainId, "pool"))!;
    assert.equal(await finishMarketRefresh(second, true), false, "an expired worker cannot overwrite its replacement");
    assert.equal(await finishMarketRefresh(restarted, true), true);
    assert.equal(refreshRetryMs(99), 3_600_000);
    const limited = await Promise.all(Array.from({ length: 13 }, (_, index) => enqueueMarketRefresh(chainId, { tokenAddresses: [`0x${(index + 7000).toString(16).padStart(40, "0")}`] }, "192.0.2.40")));
    assert.equal(limited.filter((row) => row.reason === "rate_limited").length, 1, "Postgres counters enforce the per-IP cap across concurrent requests");
    await db.execute(sql`update rate_counters set count=60 where bucket='market-refresh:global:minute'`);
    assert.equal((await enqueueMarketRefresh(chainId, { tokenAddresses: [`0x${"8".repeat(40)}`] }, "192.0.2.41")).reason, "rate_limited");
    assert.equal((await enqueueMarketRefresh(chainId, { tokenAddresses: [address] }, "not-an-ip")).reason, "rate_limited");
    await db.delete(marketRefreshRequests).where(sql`${marketRefreshRequests.chainId}=${chainId} and ${marketRefreshRequests.target} <> ${address} and ${marketRefreshRequests.target} <> ${poolId}`);
    const { processMarketRefreshRequests } = await import("./market-refresh-worker");
    await db.update(marketRefreshRequests).set({ pending: true, nextAttemptAt: new Date(0), leaseUntil: null }).where(eq(marketRefreshRequests.chainId, chainId));
    let reads = 0;
    const fail = async () => { reads++; throw new Error("provider secret must not persist"); };
    const attempted = await processMarketRefreshRequests(chainId, fail);
    assert.equal(attempted.detail?.deferred, 2);
    assert.equal(reads, 2, "one pool and one token are the entire per-tick read allocation");
    await processMarketRefreshRequests(chainId, fail);
    assert.equal(reads, 2, "restart before backoff cannot repeat provider requests");
    const persisted = await db.select().from(marketRefreshRequests).where(eq(marketRefreshRequests.chainId, chainId));
    assert.equal(persisted.every((row) => !row.lastError?.includes("secret")), true);
    const { checkMarketRpcBudget, MARKET_STATE_RPC_DAY, MARKET_DEMAND_RPC_DAY } = await import("./market-rpc-budget");
    for (const [lane, cap] of [["state", MARKET_STATE_RPC_DAY], ["demand", MARKET_DEMAND_RPC_DAY]] as const) {
      const bucket = `rpc:market-${lane}:day`;
      await db.execute(sql`insert into rate_counters(bucket,count,window_start) values(${bucket},${cap},now()) on conflict(bucket) do update set count=${cap},window_start=now()`);
      assert.equal((await checkMarketRpcBudget(lane)).ok, false, "a full persistent sub-budget refuses another provider method");
    }


  } finally {
    await db.delete(marketRefreshRequests).where(eq(marketRefreshRequests.chainId, chainId));
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await db.execute(sql`delete from rate_counters where bucket like 'market-refresh:%'`);
    await db.execute(sql`delete from rate_counters where bucket in ('rpc:market-state:day', 'rpc:market-demand:day')`);
    await close();
  }
});
