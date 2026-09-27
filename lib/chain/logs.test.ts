// Run with: node --import tsx --test lib/chain/logs.test.ts
//
// BigInt literals (0n) are avoided throughout — the project's tsconfig targets
// ES2017, which rejects that syntax — so every value goes through BigInt(...).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAmount, nextChunkSize, transferLogArgs, MIN_LOG_CHUNK_BLOCKS } from "@/lib/chain/logs";

test("transferLogArgs: a recipient becomes the indexed `to` filter, none means no filter", function () {
  assert.deepEqual(transferLogArgs("0x000000000000000000000000000000000000dEaD"), { to: "0x000000000000000000000000000000000000dEaD" });
  assert.equal(transferLogArgs(undefined), undefined);
  assert.equal(transferLogArgs(""), undefined);
});

test("decodeAmount: zero value", function () {
  assert.equal(decodeAmount(BigInt(0), 18), "0");
});

test("decodeAmount: whole number, no remainder", function () {
  assert.equal(decodeAmount(BigInt(5) * BigInt(10) ** BigInt(18), 18), "5");
});

test("decodeAmount: exact fraction under 4 digits keeps no trailing zeros", function () {
  // 1,500,000 with 6 decimals = 1.5
  assert.equal(decodeAmount(BigInt(1_500_000), 6), "1.5");
});

test("decodeAmount: truncates to at most 4 fractional digits", function () {
  // 1.23456789 with 8 decimals -> rounds to 4 places
  assert.equal(decodeAmount(BigInt(123_456_789), 8), "1.2346");
});

test("decodeAmount: rounds the 5th digit up into the 4th", function () {
  // 0.99995 with 5 decimals -> rounds to 1.0000 -> displayed as "1"
  assert.equal(decodeAmount(BigInt(99_995), 5), "1");
});

test("decodeAmount: rounding a 4th-digit carry does not touch the whole part", function () {
  // 1.99994999 with 8 decimals -> rounds to 1.9999
  assert.equal(decodeAmount(BigInt(199_994_999), 8), "1.9999");
});

test("decodeAmount: decimals=0 returns the integer as-is", function () {
  assert.equal(decodeAmount(BigInt(42), 0), "42");
});

test("decodeAmount: decimals below 4 needs no rounding step", function () {
  // 123.45 with 2 decimals
  assert.equal(decodeAmount(BigInt(12_345), 2), "123.45");
});

test("decodeAmount: large uint256-scale value stays exact, no exponent", function () {
  const value = BigInt("123456789012345678901234"); // > Number.MAX_SAFE_INTEGER
  const result = decodeAmount(value, 18);
  // Precision beyond 4 fractional digits is dropped by design, not lost to
  // float error: whole part still resolves every digit correctly.
  assert.equal(result, "123456.789");
  assert.doesNotMatch(result, /e/i);
});

test("decodeAmount: negative value keeps the sign", function () {
  assert.equal(decodeAmount(BigInt(-1_500_000), 6), "-1.5");
});

test("nextChunkSize: halves while comfortably above the floor", function () {
  assert.equal(nextChunkSize(BigInt(2000)), BigInt(1000));
  assert.equal(nextChunkSize(BigInt(1000)), BigInt(500));
  assert.equal(nextChunkSize(BigInt(500)), BigInt(250));
  assert.equal(nextChunkSize(BigInt(250)), BigInt(125));
});

test("nextChunkSize: floors at MIN_LOG_CHUNK_BLOCKS instead of undershooting", function () {
  // 125 -> 62 (integer division), still above the floor
  assert.equal(nextChunkSize(BigInt(125)), BigInt(62));
  // 62 -> 31, which is below the floor, so it clamps to the floor instead
  assert.equal(nextChunkSize(BigInt(62)), MIN_LOG_CHUNK_BLOCKS);
});

test("nextChunkSize: repeated calls at the floor stay pinned there", function () {
  assert.equal(nextChunkSize(MIN_LOG_CHUNK_BLOCKS), MIN_LOG_CHUNK_BLOCKS);
  assert.equal(nextChunkSize(nextChunkSize(MIN_LOG_CHUNK_BLOCKS)), MIN_LOG_CHUNK_BLOCKS);
});

test("nextChunkSize: full retry sequence from the default chunk size reaches the floor", function () {
  let size = BigInt(2000);
  const seen: bigint[] = [size];
  for (let i = 0; i < 10; i++) {
    size = nextChunkSize(size);
    seen.push(size);
  }
  assert.deepEqual(
    seen,
    [2000, 1000, 500, 250, 125, 62, 50, 50, 50, 50, 50].map(function toBig(n) {
      return BigInt(n);
    }),
  );
});
