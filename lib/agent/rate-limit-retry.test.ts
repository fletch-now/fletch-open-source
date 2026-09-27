import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelHttpError } from "./provider-transport";
import { retryRateLimited } from "./rate-limit-retry";

test("confirmed 429s retry at most twice and retain the same request context", async function bounded(t) {
  t.mock.method(Math, "random", () => 0);
  const attempts: number[] = [], waits: number[] = [];
  const output = await retryRateLimited(async function request(attempt) {
    attempts.push(attempt);
    if (attempt < 2) throw new ModelHttpError(429, 0);
    return "one complete response";
  }, { signal: new AbortController().signal, async onWait(ms) { waits.push(ms); } });
  assert.equal(output, "one complete response");
  assert.deepEqual(attempts, [0, 1, 2]);
  assert.deepEqual(waits, [0, 0]);
});

test("uncertain failures, long Retry-After and exhausted retries are not replayed", async function limits(t) {
  t.mock.method(Math, "random", () => 0);
  for (const error of [new ModelHttpError(503, 0), new Error("socket closed"), new ModelHttpError(401, 0), new ModelHttpError(429, 120)]) {
    let requests = 0;
    await assert.rejects(retryRateLimited(async function fail() { requests++; throw error; }, {
      signal: new AbortController().signal, async onWait() { assert.fail("Unsafe retry"); },
    }), error);
    assert.equal(requests, 1);
  }
  let requests = 0;
  await assert.rejects(retryRateLimited(async function busy() { requests++; throw new ModelHttpError(429, 0); }, {
    signal: new AbortController().signal, async onWait() {},
  }), /429/);
  assert.equal(requests, 3);
});

test("Stop interrupts a rate-limit wait before another dispatch", async function cancellation() {
  const stop = new AbortController();
  let requests = 0;
  await assert.rejects(retryRateLimited(async function busy() { requests++; throw new ModelHttpError(429, 30); }, {
    signal: stop.signal, async onWait() { stop.abort(); },
  }), { name: "AbortError" });
  assert.equal(requests, 1);
});
