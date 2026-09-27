import assert from "node:assert/strict";
import { test } from "node:test";
import { firstBlockAfter, type TimedBlock } from "./market-swap-window";

test("a rolling one-minute advance avoids searching a full day of paced block headers", async function rolling(): Promise<void> {
  const lower = BigInt(1_000_009);
  const throughNumber = BigInt(1_864_600);
  function block(number: bigint): TimedBlock { return { number, timestamp: number / BigInt(10), hash: String(number) }; }
  const through = block(throughNumber);
  const cutoff = through.timestamp - BigInt(86_400);
  let fullReads = 0;
  let hintedReads = 0;
  const full = await firstBlockAfter(async function read(number) { fullReads++; return block(number); }, through, cutoff, lower);
  const hinted = await firstBlockAfter(async function read(number) { hintedReads++; return block(number); }, through, cutoff, lower, lower + BigInt(601));
  assert.equal(hinted.number, BigInt(1_000_610), "The first block strictly after repeated cutoff timestamps is retained");
  assert.deepEqual(hinted, full);
  assert.ok(fullReads >= 20, `The previous whole-day search took ${fullReads} reads`);
  assert.ok(hintedReads <= 12, `The rolling search took ${hintedReads} reads`);
});

test("short, long and out-of-range hints preserve exact boundaries under irregular block production", async function irregular(): Promise<void> {
  const timestamps = [0, 1, 1, 1, 2, 90, 90, 90, 91, 100, 100, 100, 1000];
  async function read(number: bigint): Promise<TimedBlock> { return { number, timestamp: BigInt(timestamps[Number(number)]), hash: String(number) }; }
  const through = await read(BigInt(timestamps.length - 1));
  for (const cutoff of [0, 1, 2, 89, 90, 99, 100]) {
    const expected = timestamps.findIndex(function after(timestamp) { return timestamp > cutoff; });
    for (const hint of [-1, 0, 1, 2, 5, 8, 11, 12, 100]) {
      assert.equal((await firstBlockAfter(read, through, BigInt(cutoff), BigInt(0), BigInt(hint))).number, BigInt(expected));
    }
  }
  await assert.rejects(firstBlockAfter(async function invalid(number): Promise<TimedBlock> {
    return { number, timestamp: number === BigInt(2) ? BigInt(1001) : BigInt(0), hash: String(number) };
  }, through, BigInt(90), BigInt(0), BigInt(2)), /Nonmonotonic/);
});
