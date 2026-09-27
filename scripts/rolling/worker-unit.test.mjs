import assert from "node:assert/strict";
import { test } from "node:test";
import { workerUnit } from "./worker-unit.mjs";

test("draining generations keep dedicated, restricted proxy slots", function slots() {
  for (const port of [3902, 3903, 3904]) {
    const text = workerUnit("/opt/fletch/worker-releases/compaction", port);
    assert.ok(text.includes(`Environment=FORGE_PROXY_PORT=${port}`));
    assert.ok(text.includes("Restart=on-failure"));
  }
  for (const port of [3901, 3905, 80, 0]) assert.throws(() => workerUnit("/opt/fletch/worker-releases/compaction", port));
  assert.throws(() => workerUnit("/opt/fletch/../escape", 3904));
});
