import assert from "node:assert/strict";
import { test } from "node:test";
import { createDedicatedFetch } from "./pace";

for (const abortDuringWait of [false, true]) {
  test(`expired dedicated requests consume no dispatch or extra pacing slot (${abortDuringWait ? "during wait" : "already expired"})`, async function (t) {
    let now = 100_000;
    let dispatched = 0;
    const waits: number[] = [];
    const controller = new AbortController();
    t.mock.method(Date, "now", () => now);
    t.mock.method(globalThis, "setTimeout", function fakeTimeout(callback: () => void, ms: number) {
      waits.push(ms);
      now += ms;
      if (abortDuringWait) controller.abort();
      queueMicrotask(callback);
      return 1;
    });
    t.mock.method(globalThis, "fetch", async function fakeFetch(_: unknown, init?: RequestInit) {
      init?.signal?.throwIfAborted();
      dispatched++;
      return new Response("{}");
    });
    const fetchFn = createDedicatedFetch(40);
    await fetchFn("https://example.invalid");
    if (!abortDuringWait) controller.abort();
    await assert.rejects(fetchFn("https://example.invalid", { signal: controller.signal }));
    await fetchFn("https://example.invalid");
    assert.equal(dispatched, 2);
    assert.deepEqual(waits, [40], "the expired request must not charge another gap to the next valid request");
  });
}

test("200ms dedicated pacing counts batched RPC calls and preserves the 429 cooldown without retries", async function (t) {
  let now = 100_000;
  const dispatched: number[] = [];
  const waits: number[] = [];
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "setTimeout", function fakeTimeout(callback: () => void, ms: number) {
    waits.push(ms); now += ms; queueMicrotask(callback); return 1;
  });
  t.mock.method(globalThis, "fetch", async function () {
    dispatched.push(now);
    return new Response("{}", { status: dispatched.length === 2 ? 429 : 200 });
  });
  const fetchFn = createDedicatedFetch(200);
  await fetchFn("https://example.invalid", { body: JSON.stringify(Array.from({ length: 3 }, (_, id) => ({ jsonrpc: "2.0", id, method: "eth_chainId" }))) });
  assert.equal((await fetchFn("https://example.invalid")).status, 429);
  await fetchFn("https://example.invalid");
  assert.deepEqual(waits, [600, 20_000]);
  assert.deepEqual(dispatched, [100_000, 100_600, 120_600], "each request is dispatched exactly once");
  const legacy = createDedicatedFetch();
  await legacy("https://example.invalid");
  await legacy("https://example.invalid");
  assert.equal(waits.at(-1), 1_000, "unrelated dedicated clients keep the default pacing");
});
