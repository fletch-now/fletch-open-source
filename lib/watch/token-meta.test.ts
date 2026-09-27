import assert from "node:assert/strict";
import { test } from "node:test";
import { getChainClient } from "@/lib/chain/rpc";
import { readTokenMeta, readTokenProbe } from "./token-meta";

test("token sanity needs bytecode and decimals while preserving failed metadata as null", async function (t) {
  const client = getChainClient(46630);
  t.mock.method(client, "getBytecode", async function () { return "0x6000"; });
  t.mock.method(client, "getBlockNumber", async function () { return BigInt(100); });
  t.mock.method(client, "readContract", async function (input: { functionName: string }) {
    if (input.functionName === "decimals") return 18;
    throw new Error("metadata reverted");
  });
  const address = `0x${"7".repeat(40)}`;
  const probe = await readTokenProbe(46630, address);
  assert.equal(probe.bytecodePresent, true);
  assert.equal(probe.name, null);
  assert.equal(probe.symbol, null);
  assert.equal(probe.decimals, 18);
  assert.deepEqual(await readTokenMeta(46630, address), { name: address, symbol: address, decimals: 18 });

  t.mock.method(client, "getBytecode", async function () { throw new Error("RPC unavailable"); });
  const failed = await readTokenProbe(46630, `0x${"8".repeat(40)}`);
  assert.equal(failed.bytecodePresent, null);
  assert.equal(await readTokenMeta(46630, `0x${"8".repeat(40)}`), null);

  t.mock.method(client, "getBytecode", async function () { return undefined; });
  assert.equal((await readTokenProbe(46630, `0x${"9".repeat(40)}`)).bytecodePresent, false);
});
