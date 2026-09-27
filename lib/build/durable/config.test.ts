import assert from "node:assert/strict";
import { test } from "node:test";
import { validateWorkerEnvironment } from "./config";

const valid = { DATABASE_URL: "postgresql://fixture.invalid/test", FORGE_PROXY_BIND: "172.17.0.1", FORGE_PROXY_PORT: "3902", FORGE_WORKSPACE_ROOT: "/var/lib/fletch/workspaces", FORGE_CHECKPOINT_ROOT: "/var/lib/fletch/checkpoints" };

test("worker refuses public proxy exposure, shared ports and unsafe checkpoint storage before starting", function configuration() {
  assert.doesNotThrow(() => validateWorkerEnvironment(valid));
  for (const bind of [undefined, "0.0.0.0", "8.8.8.8", "172.32.0.1", "::", "localhost"]) {
    assert.throws(() => validateWorkerEnvironment({ ...valid, FORGE_PROXY_BIND: bind }), /IPv4/);
  }
  for (const port of [undefined, "3901", "0", "90000", "NaN"]) assert.throws(() => validateWorkerEnvironment({ ...valid, FORGE_PROXY_PORT: port }), /dedicated/);
  for (const path of [undefined, "relative", "/", "/tmp/checkpoints", "/var/lib/fletch/workspaces/checkpoints", "/var/lib/fletch"]) {
    assert.throws(() => validateWorkerEnvironment({ ...valid, FORGE_CHECKPOINT_ROOT: path }), /storage/);
  }
});
