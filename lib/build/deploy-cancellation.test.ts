import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { STOP_REQUESTED, withBuildCancellation } from "./cancellation";
import { deployToTestnet } from "./deploy";

const hash = `0x${"11".repeat(32)}`;
const address = `0x${"22".repeat(20)}`;
const block = {
  number: "0x1", hash, parentHash: hash, baseFeePerGas: "0x1", gasLimit: "0x1c9c380",
  gasUsed: "0x0", timestamp: "0x1", transactions: [], miner: address, difficulty: "0x0",
  extraData: "0x", logsBloom: `0x${"00".repeat(256)}`, nonce: "0x0000000000000000",
  receiptsRoot: hash, sha3Uncles: hash, stateRoot: hash, transactionsRoot: hash, size: "0x1",
};

test("deployment cancellation fences send after asynchronous preparation and records receipts for sends already made", { timeout: 10_000 }, async function deployment(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-deploy-"));
  const oldKey = process.env.FORGE_DEPLOYER_KEY_46630;
  const oldRpc = process.env.RPC_URL_46630;
  let controller = new AbortController();
  let stopBeforeSend = true;
  const calls: string[] = [];
  const server = createServer(async function rpc(req, res) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string };
    calls.push(request.method);
    let result: unknown;
    switch (request.method) {
      case "eth_getBalance": result = "0xde0b6b3a7640000"; break;
      case "eth_getTransactionCount": result = "0x0"; break;
      case "eth_chainId": result = "0xb626"; break;
      case "eth_getBlockByNumber": result = block; break;
      case "eth_blockNumber": result = "0x1"; break;
      case "eth_gasPrice":
      case "eth_maxPriorityFeePerGas": result = "0x1"; break;
      case "eth_estimateGas":
        if (stopBeforeSend) controller.abort(new Error(STOP_REQUESTED));
        result = "0x186a0";
        break;
      case "eth_sendRawTransaction": result = hash; break;
      case "eth_getTransactionReceipt":
        result = { transactionHash: hash, transactionIndex: "0x0", blockHash: hash, blockNumber: "0x1",
          from: address, to: null, contractAddress: address, cumulativeGasUsed: "0x1", gasUsed: "0x1",
          effectiveGasPrice: "0x1", logs: [], logsBloom: `0x${"00".repeat(256)}`, status: "0x1", type: "0x2" };
        break;
      default:
        res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: `Unexpected fixture method ${request.method}` } }));
        return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  });
  try {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    process.env.RPC_URL_46630 = `http://127.0.0.1:${port}`;
    // A public fixture key, used only against the loopback RPC above.
    process.env.FORGE_DEPLOYER_KEY_46630 = `0x${"01".padStart(64, "0")}`;
    await mkdir(join(root, "out", "StopApp.sol"), { recursive: true });
    await writeFile(join(root, "out", "StopApp.sol", "StopApp.json"), JSON.stringify({ abi: [], bytecode: { object: "0x6001600055" },
      metadata: { settings: { compilationTarget: { "contracts/StopApp.sol": "StopApp" } } } }));
    const contracts = [{ name: "StopApp", source: "contracts/StopApp.sol", bytecodeBytes: 5, functions: 0, events: 0, abi: [] }];
    await t.test("Stop while preparing gas prevents a later transaction send", async function beforeSend() {
      await assert.rejects(withBuildCancellation(controller.signal, () => deployToTestnet(root, contracts, null, null)), /Stopped by you/);
      assert.ok(calls.includes("eth_estimateGas"));
      assert.ok(!calls.includes("eth_sendRawTransaction"));
    });
    await t.test("Stop after send retains the hash and waits for its real fixture receipt", async function afterSend() {
      controller = new AbortController();
      stopBeforeSend = false;
      calls.length = 0;
      const recorded: string[] = [];
      const result = await withBuildCancellation(controller.signal, () => deployToTestnet(root, contracts, null, null, async function onBroadcast(txHash) {
        recorded.push(txHash);
        controller.abort(new Error(STOP_REQUESTED));
      }));
      assert.deepEqual(recorded, [hash]);
      assert.ok(result.ok);
      if (result.ok) {
        assert.equal(result.txHash, hash);
        assert.equal(result.address, address);
      }
      assert.equal(calls.filter((method) => method === "eth_sendRawTransaction").length, 1);
      assert.ok(calls.includes("eth_getTransactionReceipt"));
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldKey === undefined) delete process.env.FORGE_DEPLOYER_KEY_46630;
    else process.env.FORGE_DEPLOYER_KEY_46630 = oldKey;
    if (oldRpc === undefined) delete process.env.RPC_URL_46630;
    else process.env.RPC_URL_46630 = oldRpc;
    await rm(root, { recursive: true, force: true });
  }
});
