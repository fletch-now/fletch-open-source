// Run with: node --import tsx --test lib/watch/checkpoint.test.ts
//
// Only the pure decision function is tested here — detectReorg/applyReorgRollback
// need a chain client and a database, per lib/chain/logs.test.ts's precedent of
// testing the pure half of a module that also does I/O.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rollbackAncestor, REORG_MAX_ROLLBACK_BLOCKS } from "@/lib/watch/checkpoint";

test("rollbackAncestor: well above the cap rolls back exactly 64 blocks", function () {
  assert.equal(rollbackAncestor(BigInt(10_000)), BigInt(9_936));
});

test("rollbackAncestor: exactly at the cap rolls back to genesis", function () {
  assert.equal(rollbackAncestor(REORG_MAX_ROLLBACK_BLOCKS), BigInt(0));
});

test("rollbackAncestor: below the cap rolls back to genesis rather than going negative", function () {
  assert.equal(rollbackAncestor(BigInt(30)), BigInt(0));
});

test("rollbackAncestor: at genesis stays at genesis", function () {
  assert.equal(rollbackAncestor(BigInt(0)), BigInt(0));
});

test("rollbackAncestor: one block above the cap rolls back to block 1", function () {
  assert.equal(rollbackAncestor(BigInt(65)), BigInt(1));
});
