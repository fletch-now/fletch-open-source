import { test } from "node:test";
import assert from "node:assert/strict";
import { publicReadCache } from "./public-cache";

test("public cache coalesces reads without serializing Dates and isolates keys", async () => {
  const cached = publicReadCache<Date>(1000);
  let reads = 0;
  const date = new Date();
  async function read() { reads++; return date; }
  const [a, b] = await Promise.all([cached("a", read), cached("a", read)]);
  assert.equal(reads, 1);
  assert.equal(a, date);
  assert.equal(b, date);
  await cached("b", read);
  assert.equal(reads, 2);
});

test("failed reads retry; expired and evicted entries reload", async () => {
  const cached = publicReadCache<number>(1000, 1);
  await assert.rejects(cached("a", async () => { throw new Error("database down"); }));
  assert.equal(await cached("a", async () => 1), 1);
  await cached("b", async () => 2);
  assert.equal(await cached("a", async () => 3), 3);
  const expired = publicReadCache<number>(0);
  await expired("a", async () => 1);
  assert.equal(await expired("a", async () => 2), 2);
});
