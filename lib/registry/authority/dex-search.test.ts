import assert from "node:assert/strict";
import { test } from "node:test";
import { searchShapeOf } from "@/lib/registry/authority/dex";

test("a pasted contract address is answered as an address, not searched as a name", function () {
  assert.equal(searchShapeOf("0x5fc5360d0400a0fd4f2af552add042d716f1d168"), "address");
  assert.equal(searchShapeOf("  0x5FC5360D0400A0FD4F2AF552ADD042D716F1D168 "), "address");
});

test("a v4 pool id is thirty-two bytes and is answered as a pool id", function () {
  assert.equal(searchShapeOf("0x6eceab93f22dc06e0b181baaeedec95cf2e984ff3212ba1ecdae63ba0698e579"), "poolId");
});

test("everything else is text", function () {
  assert.equal(searchShapeOf("TSLA"), "text");
  assert.equal(searchShapeOf("cashcat"), "text");
  // Short of forty hex characters is a typo, not an address; it is searched.
  assert.equal(searchShapeOf("0x5fc5360d"), "text");
});
