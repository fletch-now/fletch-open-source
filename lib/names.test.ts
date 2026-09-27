import assert from "node:assert/strict";
import { test } from "node:test";
import { walletHandle } from "./names";

// The high-bit cases previously produced negative indexes or negative digits.
// The low-bit cases retain their existing handles after unsigned shifting.
const cases = [
  { kind: "high-bit", seed: "", expected: "wild-owl-24" },
  { kind: "high-bit", seed: "a", expected: "dusky-fox-60" },
  { kind: "high-bit", seed: "alice", expected: "misty-marten-51" },
  { kind: "high-bit", seed: "0x0000000000000000000000000000000000000001", expected: "amber-otter-88" },
  { kind: "high-bit", seed: "0xffffffffffffffffffffffffffffffffffffffff", expected: "wild-vole-48" },
  { kind: "high-bit", seed: "0x1234567890123456789012345678901234567890", expected: "wild-rook-96" },
  { kind: "low-bit", seed: "wallet-0", expected: "lunar-wren-42" },
  { kind: "low-bit", seed: "wallet-1", expected: "green-rook-33" },
  { kind: "low-bit", seed: "wallet-2", expected: "quiet-lark-24" },
  { kind: "low-bit", seed: "wallet-3", expected: "brisk-hare-16" },
];

for (const { kind, seed, expected } of cases) {
  test(`wallet handle uses unsigned ${kind} hash: ${JSON.stringify(seed)}`, function handle() {
    assert.equal(walletHandle(seed), expected);
    assert.match(walletHandle(seed), /^[a-z]+-[a-z]+-[1-9][0-9]$/);
  });
}
