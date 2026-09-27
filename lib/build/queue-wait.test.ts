import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { test } from "node:test";
import { waitForQueuePoll } from "./queue-wait";

test("repeated queue polls release their abort listeners after each timer", async function polls() {
  const controller = new AbortController();
  for (let poll = 0; poll < 200; poll += 1) {
    const waiting = waitForQueuePoll(1, controller.signal);
    assert.ok(getEventListeners(controller.signal, "abort").length <= 1);
    await waiting;
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  }
});

test("disconnect promptly ends a long queue wait and removes its listener", { timeout: 1000 }, async function disconnect() {
  const controller = new AbortController();
  const waiting = waitForQueuePoll(60_000, controller.signal);
  controller.abort();
  await waiting;
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("an already disconnected request does not wait for the next queue poll", { timeout: 1000 }, async function disconnected() {
  const controller = new AbortController();
  controller.abort();
  await waitForQueuePoll(60_000, controller.signal);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});
