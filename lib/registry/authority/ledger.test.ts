import assert from "node:assert/strict";
import { test } from "node:test";
import type { PublicClient } from "viem";
import { activityBuckets } from "./ledger";

function fixture(timestamps: number[]) {
  let outstanding = 0;
  let peak = 0;
  const requested: bigint[] = [];
  const blocks = timestamps.map((_, index) => BigInt(index));
  const client = { getBlock: async ({ blockNumber }: { blockNumber: bigint }) => {
    outstanding += 1;
    peak = Math.max(peak, outstanding);
    requested.push(blockNumber);
    await new Promise<void>((resolve) => setImmediate(resolve));
    outstanding -= 1;
    return { timestamp: BigInt(timestamps[Number(blockNumber)]) };
  } } as unknown as PublicClient;
  return { client, blocks, requested, peak: () => peak };
}

function seconds(date: string): number { return Date.parse(date) / 1000; }

test("dense ledger window uses two exact endpoint reads with one request queued", async function () {
  const start = seconds("2026-09-08T14:00:00Z");
  const f = fixture(Array.from({ length: 5000 }, (_, index) => start + Math.floor(index / 10)));
  const buckets = await activityBuckets(4663, [...f.blocks, BigInt(3)], f.client);
  assert.equal(f.peak(), 1);
  assert.deepEqual(f.requested, [BigInt(0), BigInt(4999)]);
  assert.equal(buckets.size, 5000);
  for (const bucket of buckets.values()) assert.deepEqual(bucket, { day: "2026-09-08", marketOpen: true });
});

test("ledger buckets split exactly across UTC midnight and New York opening and closing", async function () {
  for (const [before, after, expected] of [
    ["2026-09-08T23:59:59Z", "2026-09-09T00:00:00Z", [{ day: "2026-09-08", marketOpen: false }, { day: "2026-09-09", marketOpen: false }]],
    ["2026-09-08T13:29:59Z", "2026-09-08T13:30:00Z", [{ day: "2026-09-08", marketOpen: false }, { day: "2026-09-08", marketOpen: true }]],
    ["2026-09-08T19:59:59Z", "2026-09-08T20:00:00Z", [{ day: "2026-09-08", marketOpen: true }, { day: "2026-09-08", marketOpen: false }]],
    ["2026-11-02T14:29:59Z", "2026-11-02T14:30:00Z", [{ day: "2026-11-02", marketOpen: false }, { day: "2026-11-02", marketOpen: true }]],
  ] as const) {
    const f = fixture([seconds(before), seconds(before), seconds(after), seconds(after)]);
    const result = await activityBuckets(4663, f.blocks, f.client);
    assert.deepEqual(result.get(BigInt(1)), expected[0]);
    assert.deepEqual(result.get(BigInt(2)), expected[1]);
    assert.equal(new Set(f.requested).size, f.requested.length, "boundary reads must be cached");
  }
});

test("DST weekend remains outside market hours and single blocks cost one read", async function () {
  const f = fixture([seconds("2026-11-01T05:59:59Z"), seconds("2026-11-01T06:00:00Z")]);
  const buckets = await activityBuckets(4663, f.blocks, f.client);
  for (const bucket of buckets.values()) assert.deepEqual(bucket, { day: "2026-11-01", marketOpen: false });
  const single = fixture([seconds("2026-09-08T13:30:00Z")]);
  const result = await activityBuckets(4663, single.blocks, single.client);
  assert.equal(single.requested.length, 1);
  assert.equal(result.get(BigInt(0))?.marketOpen, true);
});

test("invalid observed timestamp order fails before any activity can be committed", async function () {
  const f = fixture([2000, 1000]);
  await assert.rejects(activityBuckets(4663, f.blocks, f.client), /not monotonic/);
});
