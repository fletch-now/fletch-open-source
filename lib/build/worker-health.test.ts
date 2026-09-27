import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWorkerAvailability } from "./worker-health";
import { describeBuildQueue } from "./queue-status";

test("queue distinguishes fresh, stale and blocked workers", function availability(): void {
  const checkedAt = "2026-09-14T12:00:00.000Z";
  const fresh = Date.parse(checkedAt) + 1000;
  const value = JSON.stringify({ checkedAt, ready: true });
  assert.equal(parseWorkerAvailability(value, fresh)?.state, "ready");
  const offline = parseWorkerAvailability(value, fresh + 20_000)!;
  assert.equal(offline.state, "offline");
  assert.equal(parseWorkerAvailability(JSON.stringify({ checkedAt, ready: false }), fresh)?.state, "capacity_wait");
  const queue = { position: 4, ahead: 3, running: 0, reserved: 0, capacity: 3, worker: offline };
  assert.match(describeBuildQueue(queue).description, /stopped reporting/);
  assert.equal(parseWorkerAvailability(null), undefined);
  assert.equal(parseWorkerAvailability("bad json"), undefined);
});
