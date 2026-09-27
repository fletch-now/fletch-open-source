import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createPublicClient, custom, encodeAbiParameters, toHex } from "viem";
import { EMPTY_HOLDER_POLICY, type HolderPolicy } from "./model";
import { observeHolding, validateRewardMarket, type RewardMarket } from "./observe";

const wallet = `0x${"a".repeat(40)}`;
const policy: HolderPolicy = { ...EMPTY_HOLDER_POLICY, enabled: true, chainId: 4663, tokenAddress: `0x${"b".repeat(40)}`, referencePoolId: "pool", period: "once", immediateGrantAccepted: true };
const hash = `0x${"1".repeat(64)}`;
function market(): RewardMarket {
  const at = new Date(Date.now() - 1000);
  return { pool_id: "pool", price_usd: "2", depth_usd: "25000", observed_at: at, block_number: "10", block_hash: hash, reason: null,
    quote_observation: { value: 1, source: "reference", sourceId: "test", sourceAt: at.toISOString(), fetchedAt: at.toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString(), method: "fixed_notional_usdg", blockNumber: "10", blockHash: hash, parameters: {}, reason: null } };
}

test("missing, shallow, expired and invalid market observations delay credit grants", () => {
  const valid = market();
  assert.equal(validateRewardMarket(valid, policy, Date.now()), valid);
  for (const patch of [{ depth_usd: "24999.99" }, { observed_at: new Date(Date.now() - 121_000) }, { observed_at: new Date(Date.now() + 5000) }, { quote_observation: null }, { reason: "stale" }, { pool_id: "wrong" }, { block_hash: null }, { price_usd: "0" }]) {
    assert.throws(() => validateRewardMarket({ ...valid, ...patch } as RewardMarket, policy, Date.now()));
  }
  for (const patch of [{ value: Infinity }, { value: null }, { expiresAt: new Date(Date.now() - 1).toISOString() }, { reason: "quote failed" }, { fetchedAt: null }]) {
    assert.throws(() => validateRewardMarket({ ...valid, quote_observation: { ...valid.quote_observation!, ...patch } }, policy, Date.now()));
  }
});

test("RPC checks bind token and wallet to settled/current blocks and fail on reorganizations", async () => {
  let mode = "ok";
  const calls: Array<{ method: string; params: unknown[] }> = [];
  const client = createPublicClient({ transport: custom({ request: async ({ method, params }) => {
    const values = params as unknown[] ?? [];
    calls.push({ method, params: values });
    if (mode === "offline") throw new Error("controlled RPC failure");
    if (method === "eth_chainId") return toHex(mode === "wrong-chain" ? 1 : 4663);
    if (method === "eth_getCode") return mode === "no-code" ? "0x" : "0x6000";
    if (method === "eth_getBlockByNumber") {
      const block = values[0];
      const latest = block === "latest" || block === "0xb";
      return { number: latest ? "0xb" : "0xa", hash: mode === "reorg" && block === "0xb" ? `0x${"2".repeat(64)}` : hash,
        timestamp: toHex(Math.floor(Date.now() / 1000) - (mode === "stale-chain" ? 500 : latest ? 1 : 2)), transactions: [], gasLimit: "0x0", gasUsed: "0x0", size: "0x0", difficulty: "0x0" };
    }
    if (method === "eth_call") {
      const call = values[0] as { data: string; to: string };
      assert.equal(call.to.toLowerCase(), policy.tokenAddress);
      if (call.data === "0x313ce567") return encodeAbiParameters([{ type: "uint8" }], [6]);
      assert.ok(call.data.endsWith(wallet.slice(2)));
      return encodeAbiParameters([{ type: "uint256" }], [BigInt(values[1] === "0xa" ? "60000000" : "50000000")]);
    }
    throw new Error(`Unexpected RPC method ${method}`);
  } }, { retryCount: 0 }) });
  const evidence = await observeHolding(policy, wallet, { client, readMarket: async () => market() });
  assert.equal(evidence.balanceRaw, "50000000");
  assert.equal(evidence.safeBlock, "10");
  assert.equal(evidence.latestBlock, "11");
  assert.equal(calls.filter(call => call.method === "eth_call").length, 3);
  for (const fault of ["reorg", "stale-chain", "wrong-chain", "no-code", "offline"]) {
    mode = fault;
    await assert.rejects(observeHolding(policy, wallet, { client, readMarket: async () => market() }));
  }
});
