import assert from "node:assert/strict";
import test from "node:test";
import { executorAlias, parseExecutorSnapshot } from "./executor";

const HOST = "a".repeat(64);
const NOW = 1_800_000_000_000;
const ENV = { FORGE_EXECUTOR_SSH: "fletch-executor", DOCKER_HOST: "ssh://fletch-executor",
  DOCKER_CONFIG: "/etc/fletch/docker-client", FORGE_EXECUTOR_HOST_ID: HOST };
const SNAPSHOT = { version: 1, atMs: NOW, hostId: HOST, platform: "linux", logicalCpus: 8,
  totalMemoryBytes: 32 * 1024 ** 3, cgroupParent: "fletch-builds.slice", cgroupDriver: "systemd",
  cgroupCpuQuota: 6, cgroupMemoryBytes: 24 * 1024 ** 3, sliceMemoryBytes: 7 * 1024 ** 3,
  hostAvailableBytes: 20 * 1024 ** 3, workspaceMounted: true, modelRelayReady: true };

test("remote execution requires matching transport, pinned identity and host-owned client config", function configuration() {
  assert.equal(executorAlias({}), null);
  assert.equal(executorAlias({ DOCKER_HOST: "unix:///var/run/docker.sock" }), null);
  assert.equal(executorAlias(ENV), "fletch-executor");
  for (const change of [{ FORGE_EXECUTOR_SSH: undefined }, { FORGE_EXECUTOR_SSH: "-oProxyCommand=unsafe" },
    { DOCKER_HOST: "ssh://other-host" }, { DOCKER_CONTEXT: "other" }, { FORGE_EXECUTOR_HOST_ID: undefined },
    { DOCKER_CONFIG: "/var/lib/fletch/workspaces/project/.docker" }]) {
    assert.throws(() => executorAlias({ ...ENV, ...change }));
  }
});

test("admission rejects stale, foreign, unmounted and malformed remote resources", function observations() {
  assert.equal(parseExecutorSnapshot(SNAPSHOT, HOST, NOW).sliceMemoryBytes, 7 * 1024 ** 3);
  for (const change of [{ version: 2 }, { atMs: NOW - 15_001 }, { atMs: NOW + 15_001 }, { hostId: "b".repeat(64) },
    { workspaceMounted: false }, { modelRelayReady: false }, { cgroupDriver: "cgroupfs" }, { cgroupParent: "other.slice" }, { logicalCpus: 0 },
    { cgroupCpuQuota: Infinity }, { cgroupCpuQuota: 9 }, { cgroupMemoryBytes: 40 * 1024 ** 3 },
    { sliceMemoryBytes: -1 }, { hostAvailableBytes: Number.MAX_SAFE_INTEGER }, { totalMemoryBytes: "32g" }]) {
    assert.throws(() => parseExecutorSnapshot({ ...SNAPSHOT, ...change }, HOST, NOW));
  }
  for (const value of [null, [], "{}", {}]) assert.throws(() => parseExecutorSnapshot(value, HOST, NOW));
});
