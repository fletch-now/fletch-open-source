import { test } from "node:test";
import assert from "node:assert/strict";
import { creditsFor, parseTreasury, purchaseKey, sumValue, transfersToTreasury, USDG, type TransferLike } from "./usdg";

const TREASURY = "0x000000000000000000000000000000000000dEaD";
const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

function transfer(from: string, to: string, usdg: number, address: string = USDG.address): TransferLike {
  return { address, from, to, value: BigInt(Math.round(usdg * 1_000_000)) };
}

test("10 USDG buys 25 credits", function () {
  assert.equal(creditsFor(BigInt(10_000_000)), 25);
});

test("0.40 USDG buys one credit, 0.39 buys none", function () {
  assert.equal(creditsFor(BigInt(400_000)), 1);
  assert.equal(creditsFor(BigInt(390_000)), 0);
});

test("an overpayment credits what was paid, floored", function () {
  assert.equal(creditsFor(BigInt(20_000_000)), 50);
  assert.equal(creditsFor(BigInt(1_000_000)), 2);
});

test("only USDG transfers from a signed-in wallet to the treasury count", function () {
  const logs = [
    transfer(WALLET, TREASURY, 4),
    transfer(WALLET, TREASURY, 2, "0x0bd7d308f8e1639fab988df18a8011f41eacad73"),
    transfer(OTHER, TREASURY, 100),
    transfer(WALLET, OTHER, 100),
  ];
  const matched = transfersToTreasury(logs, TREASURY.toLowerCase(), [WALLET.toUpperCase()]);
  assert.equal(matched.length, 1);
  assert.equal(creditsFor(sumValue(matched)), 10);
});

test("several transfers in one receipt are summed", function () {
  const logs = [transfer(WALLET, TREASURY, 0.2), transfer(WALLET, TREASURY, 0.2)];
  assert.equal(creditsFor(sumValue(transfersToTreasury(logs, TREASURY, [WALLET]))), 1);
});

test("parseTreasury checksums a valid address and refuses anything else", function () {
  assert.equal(parseTreasury("0x000000000000000000000000000000000000dead"), "0x000000000000000000000000000000000000dEaD");
  assert.equal(parseTreasury("dead"), null);
  assert.equal(parseTreasury(undefined), null);
  assert.equal(parseTreasury(""), null);
});

test("the purchase key is the chain and the lowercased hash", function () {
  assert.equal(purchaseKey("0xABC"), "usdg:4663:0xabc");
});
