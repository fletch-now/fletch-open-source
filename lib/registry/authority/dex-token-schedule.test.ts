import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import type { PublicClient } from "viem";
import { metadataBacklog, metadataBacklogFromDetail, selectTokenReads, TOKEN_REFRESH_MS, TOKEN_RETRY_MS, tokenReadDue } from "./dex-token-schedule";

process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

test("metadata selection prioritizes visible pools without starving oldest discoveries", function () {
  const now = new Date("2026-09-08T12:00:00Z");
  const addresses = ["a", "b", "c", "d", "e", "f", "g"];
  const known = new Map([["g", { checkedAt: now, error: null }]]);
  const visible = new Set(["c", "d", "e", "f"]);
  assert.deepEqual(selectTokenReads(addresses, known, visible, now, 5), ["c", "d", "e", "a", "f"]);
  assert.deepEqual(selectTokenReads(addresses, known, visible, now, 5, new Map([["f", 1000], ["d", 10], ["c", 1]])), ["f", "d", "c", "a", "e"], "deepest associated active pools win while oldest backlog retains a slot");
  const backlog = metadataBacklog(addresses, known, visible, now);
  assert.equal(backlog.total, 7);
  assert.equal(backlog.due, 6);
  assert.equal(backlog.visibleDue, 4);
  assert.equal(backlog.neverRead, 6);
  assert.deepEqual(metadataBacklogFromDetail({ metadataBacklog: backlog }), backlog);
  assert.equal(metadataBacklogFromDetail({ metadataBacklog: { ...backlog, due: -1 } }), null);
  assert.equal(tokenReadDue({ checkedAt: new Date(now.getTime() - TOKEN_REFRESH_MS), error: null }, now), true);
  assert.equal(tokenReadDue({ checkedAt: new Date(now.getTime() - TOKEN_RETRY_MS), error: "failed" }, now), true);
  assert.equal(tokenReadDue({ checkedAt: new Date(now.getTime() + 1), error: null }, now), true);
});

test("four truncated scheduler minutes reserve one first read for the oldest discovery", function () {
  for (const completedPerPass of [1, 2, 3]) {
    const addresses = ["000-old", ...Array.from({ length: 20 }, (_, n) => `active-${String(n).padStart(2, "0")}`)];
    const visible = new Set(addresses.slice(1));
    const known = new Map<string, { checkedAt: Date; error: null }>();
    const firstReads: string[] = [];
    for (let minute = 0; minute < 4; minute++) {
      const now = new Date(Date.parse("2026-09-08T12:00:00Z") + minute * 60_000);
      const ordered = selectTokenReads(addresses, known, visible, now, 12);
      assert.deepEqual(selectTokenReads(addresses, known, visible, now, 12), ordered, "same minute is deterministic");
      firstReads.push(ordered[0]);
      for (const address of ordered.slice(0, completedPerPass)) known.set(address, { checkedAt: now, error: null });
    }
    assert.ok(known.has("000-old"), `${completedPerPass}-token deadlines still service the oldest discovery`);
    if (completedPerPass === 1) assert.deepEqual(firstReads, ["active-00", "active-01", "active-02", "000-old"], "three priority first reads and one fair first read");
  }
});

test("metadata work deadline saves each completed token and restart resumes only unread rows", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function () {
  const { db, close } = await import("@/lib/db");
  const { dexTokens, dexPools } = await import("@/lib/db/schema");
  const { refreshDexTokens } = await import("./dex");
  const chainId = 777351;
  let now = new Date("2026-09-08T12:00:00Z");
  const firstSeen = new Date("2026-09-01T00:00:00Z");
  const addresses = Array.from({ length: 5 }, (_, index) => `0x${(index + 1).toString(16).padStart(40, "0")}`);
  const probed: string[] = [];
  const client = {
    multicall: async function ({ contracts }: { contracts: unknown[] }) {
      now = new Date(now.getTime() + 1_000);
      const values = ["FIX", "Fixture", 18, BigInt(1000), BigInt(0), BigInt(0)];
      return contracts.map((_, index) => ({ status: "success", result: values[index % 6] }));
    },
    getBytecode: async function ({ address }: { address: string }) {
      probed.push(address);
      now = new Date(now.getTime() + 40_000);
      return "0x6000";
    },
  } as unknown as PublicClient;
  try {
    await db.insert(dexTokens).values(addresses.map((address) => ({ id: `${chainId}:${address}`, chainId, address, source: "user_submitted", firstSeenAt: firstSeen, hidden: true })));
    const first = await refreshDexTokens(chainId, undefined, { client, now: () => now, workMs: 90_000 });
    assert.equal(first.rows, 3);
    assert.equal(metadataBacklogFromDetail(first.detail)?.due, 2);
    const saved = await db.select().from(dexTokens).where(eq(dexTokens.chainId, chainId));
    const completed = saved.filter((row) => row.checkedAt);
    assert.equal(completed.length, 3);
    assert.equal(new Set(completed.map((row) => row.checkedAt?.toISOString())).size, 3, "each bytecode completion has its actual timestamp");
    assert.equal(completed.every((row) => row.supplyCheckedAt?.toISOString() === "2026-09-08T12:00:01.000Z"), true, "supply records the actual multicall observation");
    assert.equal(saved.every((row) => row.hidden && row.source === "user_submitted" && row.firstSeenAt.toISOString() === firstSeen.toISOString()), true);
    const resumed = await refreshDexTokens(chainId, undefined, { client, now: () => now, workMs: 90_000 });
    assert.equal(resumed.rows, 2);
    assert.equal(metadataBacklogFromDetail(resumed.detail)?.due, 0);
    assert.equal(new Set(probed).size, 5, "restart never repeats the saved reads");
    const idle = await refreshDexTokens(chainId, undefined, { client, now: () => now });
    assert.equal(idle.rows, 0);
    assert.equal(probed.length, 5);
    await db.update(dexTokens).set({ checkedAt: null }).where(eq(dexTokens.chainId, chainId));
    const immediate = await refreshDexTokens(chainId, addresses, { client: { ...client, getBytecode: async () => "0x6000" } as PublicClient, now: () => now });
    assert.equal(immediate.rows, 5, "immediate discovery selection must not be restricted to one four-token RPC group");
    await db.update(dexTokens).set({ checkedAt: null }).where(eq(dexTokens.chainId, chainId));
    const refused = { multicall: async () => Array.from({ length: 24 }, () => ({ status: "failure" })) } as unknown as PublicClient;
    await assert.rejects(refreshDexTokens(chainId, undefined, { client: refused, now: () => now }), /RPC refused/);
    const untouched = await db.select().from(dexTokens).where(eq(dexTokens.chainId, chainId));
    assert.equal(untouched.every((row) => row.checkedAt === null), true, "provider refusal cannot make a job or its tokens fresh");
    const { createPublicClient, http, decodeFunctionData, encodeFunctionResult, multicall3Abi } = await import("viem");
    let requests = 0;
    let transportUnavailable = false;
    let emptySuccessfulSubcalls = false;
    const reverting = createPublicClient({ transport: http("https://example.invalid", { retryCount: 0, fetchFn: async function aggregateResponse(_, init) {
      requests++;
      if (transportUnavailable) return new Response("Unavailable", { status: 503 });
      const request = JSON.parse(String(init?.body));
      let result = "0x6000";
      if (request.method === "eth_call") {
        const decoded = decodeFunctionData({ abi: multicall3Abi, data: request.params[0].data });
        const calls = decoded.args?.[0] as readonly unknown[];
        result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: calls.map(() => ({ success: emptySuccessfulSubcalls, returnData: "0x" as const })) });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), { headers: { "content-type": "application/json" } });
    } }) });
    const nonTokens = await refreshDexTokens(chainId, undefined, { client: reverting, now: () => now });
    assert.equal(nonTokens.rows, 5, "successful aggregate calls with reverted token methods must leave durable unknown metadata");
    assert.equal(nonTokens.detail?.failed, 5);
    assert.match(nonTokens.error ?? "", /5 token metadata reads failed/);
    const unknown = await db.select().from(dexTokens).where(eq(dexTokens.chainId, chainId));
    assert.equal(unknown.every((row) => row.checkedAt !== null && row.bytecodePresent === true && row.decimals === null && row.totalSupplyRaw === null && row.error !== null), true);
    const beforeRetry = requests;
    await refreshDexTokens(chainId, undefined, { client: reverting, now: () => now });
    assert.equal(requests, beforeRetry, "non-ERC20 candidates must not trap every run on the same four addresses");
    emptySuccessfulSubcalls = true;
    await db.update(dexTokens).set({ checkedAt: null }).where(eq(dexTokens.chainId, chainId));
    const emptyReturns = await refreshDexTokens(chainId, undefined, { client: reverting, now: () => now });
    assert.equal(emptyReturns.rows, 5, "successful EVM calls returning no ABI data are unknown token metadata, not transport failures");
    transportUnavailable = true;
    await db.update(dexTokens).set({ checkedAt: null }).where(eq(dexTokens.chainId, chainId));
    await assert.rejects(refreshDexTokens(chainId, undefined, { client: reverting, now: () => now }), /RPC refused/);
    const afterTransportFailure = await db.select().from(dexTokens).where(eq(dexTokens.chainId, chainId));
    assert.equal(afterTransportFailure.every((row) => row.checkedAt === null), true, "real viem aggregate transport failures must not become token-level evidence");
    const discoveries = [6, 7, 8].map((n) => `0x${n.toString(16).padStart(40, "0")}`);
    await db.insert(dexPools).values(discoveries.map((address, index) => ({
      id: `${chainId}:pool:${index}`, chainId, tokenAddress: address, currency0: address, currency1: addresses[0],
      fee: 3000, tickSpacing: 60, hooks: addresses[0], createdBlock: BigInt(index + 1),
      canonical: index !== 2, tier: index === 1 ? "dormant" : "active",
    })));
    const { dueTokenReads } = await import("./dex-token-queue");
    assert.deepEqual(await dueTokenReads(chainId, now, null, 12, true), [addresses[0], discoveries[0]], "continuous admission excludes standalone dead records, dormant pools and withdrawn factory logs");
    const admitted = await refreshDexTokens(chainId, undefined, { client: { ...client, getBytecode: async () => "0x6000" } as PublicClient,
      now: () => now, limit: 12, poolCandidatesOnly: true });
    assert.equal(admitted.rows, 2, "both currencies of a canonical pool autonomously enter metadata admission");
    assert.equal(metadataBacklogFromDetail(admitted.detail)?.total, 2);
    const discovered = (await db.select().from(dexTokens).where(eq(dexTokens.address, discoveries[0]))).find((row) => row.chainId === chainId);
    assert.equal(discovered?.symbol, "FIX");
    assert.equal(discovered?.source, "factory_scan");
    const pools = await db.select().from(dexPools).where(eq(dexPools.chainId, chainId));
    assert.ok(pools.every((row) => row.depthUsd === null), "metadata admission never invents pool depth");

  } finally {
    await db.delete(dexPools).where(eq(dexPools.chainId, chainId));
    await db.delete(dexTokens).where(eq(dexTokens.chainId, chainId));
    await close();
  }
});
