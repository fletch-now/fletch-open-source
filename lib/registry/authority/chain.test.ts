import assert from "node:assert/strict";
import { test } from "node:test";
import { isRateLimit } from "./chain";

class RpcLike extends Error {
  status?: number;
  code?: number;
  shortMessage?: string;
  details?: string;
  constructor(message: string, extra: { status?: number; code?: number; shortMessage?: string; details?: string }) {
    super(message);
    Object.assign(this, extra);
  }
}

test("a 429 status or code is a rate limit", function () {
  assert.equal(isRateLimit(new RpcLike("HTTP request failed.", { status: 429 })), true);
  assert.equal(isRateLimit(new RpcLike("RPC Request failed.", { code: 429, details: "Too Many Requests" })), true);
});

test("a result-size refusal is not a rate limit even when the request body contains 429", function () {
  const error = new RpcLike('Missing or invalid parameters.\n\nRequest body: {"address":["0x4290000000000000000000000000000000004290"]}', {
    code: -32602,
    shortMessage: "Missing or invalid parameters.",
    details: "logs matched by query exceeds limit of 10000",
  });
  assert.equal(isRateLimit(error), false);
});

test("a bounded scan stops after a committed window and resumes without repeating it", async function () {
  const { scanLogs } = await import("./chain");
  const calls: Array<[bigint, bigint]> = [];
  const client = { getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
    calls.push([fromBlock, toBlock]);
    return [];
  } } as unknown as import("viem").PublicClient;
  let committed = BigInt(0);
  const params = {
    client, addresses: [],
    abi: [{ type: "event", name: "Example", inputs: [] }] as const,
    eventName: "Example", chunk: BigInt(5), minChunk: BigInt(1), label: "bounded-test", maxWindows: 1,
    onWindow: async (_logs: unknown[], to: bigint) => { committed = to; },
  };
  await scanLogs({ ...params, range: { fromBlock: BigInt(1), toBlock: BigInt(12) } });
  assert.equal(committed, BigInt(5));
  await scanLogs({ ...params, range: { fromBlock: committed + BigInt(1), toBlock: BigInt(12) } });
  assert.equal(committed, BigInt(10));
  assert.deepEqual(calls, [[BigInt(1), BigInt(5)], [BigInt(6), BigInt(10)]]);
});
