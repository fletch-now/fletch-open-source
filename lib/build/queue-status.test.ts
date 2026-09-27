import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { BuildReply } from "@/components/chat/build-reply";
import { describeBuildQueue } from "./queue-status";
import type { BuildQueueState } from "./queue-types";

const next: BuildQueueState = { position: 1, ahead: 0, running: 0, reserved: 0, capacity: 2 };

test("shared admission explains available slots without promising immediate worker pickup", function memoryAdmission() {
  const queue = { ...next, capacity: 20, running: 12, memoryManaged: true };
  const html = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue }));
  assert.match(html, /12 of 20 building/);
  assert.match(html, /slot and enough memory are available/);
  assert.match(html, /Cancel queue/);
  assert.match(html, /Edit prompt/);
  assert.doesNotMatch(html, /Waiting for the worker to pick it up|Your build has started/);
});

test("a saved build awaiting worker pickup does not claim occupied slots or started work", function available() {
  const message = describeBuildQueue(next);
  assert.equal(message.title, "Waiting to start");
  const html = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue: next }));
  assert.match(html, /Waiting for the worker to pick it up/);
  assert.match(html, /0 of 2 building/);
  assert.match(html, /Next in line/);
  assert.doesNotMatch(html, /data-build-loader|Waiting for a build slot|Your build has started/);
  assert.match(html, /Cancel queue/);
  assert.match(html, /Edit prompt/);
});

test("queue position and occupied capacity have different explanations", function occupied() {
  assert.equal(describeBuildQueue({ ...next, running: 2 }).title, "Next in line");
  const behind = describeBuildQueue({ ...next, position: 3, ahead: 2, running: 2 });
  assert.equal(behind.title, "Waiting in queue");
  assert.match(behind.description, /2 builds are ahead/);
  const held = describeBuildQueue({ ...next, reserved: 2 });
  assert.equal(held.title, "Waiting for capacity");
  assert.match(held.description, /earlier interruption/);
  assert.equal(describeBuildQueue({ ...next, reserved: 1 }).title, "Waiting to start");
});

test("reconnecting marks the saved position as last recorded instead of claiming it is current", function reconnecting() {
  const html = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue: next, reconnecting: true }));
  assert.match(html, /Reconnecting/);
  assert.match(html, /last recorded position/);
  assert.doesNotMatch(html, /Waiting for the worker to pick it up/);
});

test("maintenance holds an empty queue without removing Cancel/Edit, and reconnect labels recorded state", function maintenance() {
  const state = { phase: "draining" as const, startedAt: null, heartbeatAt: null, expiresAt: null, stale: true };
  const queue = { ...next, maintenance: state };
  const html = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue }));
  assert.match(html, /Builder update/);
  assert.match(html, /Your build is saved and will start when the update finishes/);
  assert.match(html, /Cancel queue/);
  assert.match(html, /Edit prompt/);
  assert.match(html, /0 of 2 building/);
  assert.doesNotMatch(html, /Waiting for the worker to pick it up|data-build-loader/);
  const reconnected = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue, reconnecting: true }));
  assert.match(reconnected, /Last recorded status: builder update/);
  assert.doesNotMatch(reconnected, /will start when the update finishes/);
  const running = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, maintenance: state }));
  assert.match(running, /Your current build continues/);
  assert.match(running, /data-build-loader/);
  assert.doesNotMatch(running, /Cancel queue|Edit prompt/);
  const terminal = renderToStaticMarkup(createElement(BuildReply, { content: "Done", maintenance: state }));
  assert.doesNotMatch(terminal, /Your current build continues/);
});
