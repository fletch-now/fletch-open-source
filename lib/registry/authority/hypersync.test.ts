import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAbi } from "viem";
import { hypersyncLogs, toLog, topicFilter } from "./hypersync";

const abi = parseAbi(["event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1)", "event Transfer(address indexed from, address indexed to, uint256 value)"]);

test("a truncated HyperSync response cannot advance a scanner checkpoint", async function (t) {
  t.mock.method(globalThis, "fetch", async function () {
    return Response.json({ data: [] });
  });
  await assert.rejects(hypersyncLogs({ url: "https://fixture.example", apiKey: "fixture" }, {
    addresses: [], abi, eventName: "Transfer", fromBlock: BigInt(100), toBlock: BigInt(200),
  }), /incomplete page/);
});

test("a HyperSync log decodes like an RPC log", function () {
  const log = toLog({
    address: "0x83660951cb1c6c25ffb1d1f5db3418cd1a6a0951",
    data: "0x00",
    topic0: "0xaaaa",
    topic1: "0xbbbb",
    topic2: null,
    topic3: null,
    block_number: 55_000_000,
    transaction_hash: "0xcccc",
    log_index: 3,
    transaction_index: 1,
  });
  assert.equal(log.blockNumber, BigInt(55_000_000));
  assert.deepEqual(log.topics, ["0xaaaa", "0xbbbb"]);
  assert.equal(log.logIndex, 3);
});

test("the topic filter carries the event signature and an indexed-argument list", function () {
  const ids = ["0x" + "11".repeat(32), "0x" + "22".repeat(32)] as `0x${string}`[];
  const filter = topicFilter({ addresses: [], abi, eventName: "Swap", args: { id: ids }, fromBlock: BigInt(0), toBlock: BigInt(1) });
  assert.equal(filter[0].length, 1);
  assert.deepEqual(filter[1], ids);
});

test("two events without args become one position of two signatures", function () {
  const filter = topicFilter({ addresses: [], abi, eventName: ["Swap", "Transfer"], fromBlock: BigInt(0), toBlock: BigInt(1) });
  assert.equal(filter[0].length, 2);
  assert.equal(filter.length, 1);
});
