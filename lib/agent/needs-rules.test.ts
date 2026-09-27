import assert from "node:assert/strict";
import { test } from "node:test";
import { hasWalletCode, needsDirective, parseVerdict } from "./needs-rules";

test("parses a plain verdict", function () {
  assert.deepEqual(parseVerdict('{"contract": false, "wallet": false, "reason": "Only reads gas."}'), {
    contract: false,
    wallet: false,
    reason: "Only reads gas.",
  });
});

test("tolerates fences and prose around the object", function () {
  const text = 'Sure.\n```json\n{"contract": true, "wallet": false, "reason": "Pools ETH between players."}\n```';
  assert.deepEqual(parseVerdict(text), { contract: true, wallet: true, reason: "Pools ETH between players." });
});

test("rejects answers without both booleans", function () {
  assert.equal(parseVerdict('{"contract": "no"}'), null);
  assert.equal(parseVerdict("no idea"), null);
});

test("finds wallet code and ignores a public client", function () {
  assert.equal(hasWalletCode('import { useAccount } from "wagmi";'), true);
  assert.equal(hasWalletCode("const client = createPublicClient({ chain, transport: http() });"), false);
});

test("the directive states the no-contract, no-wallet case as an instruction", function () {
  const text = needsDirective({ contract: false, wallet: false, reason: "Reads gas.", source: "model" });
  assert.match(text, /No contract/);
  assert.match(text, /No wallet connection/);
});
