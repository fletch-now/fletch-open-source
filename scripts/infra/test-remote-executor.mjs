// Real two-host execution, shared source, checkpoints and Stop; no model requests.
import "../../workers/server-runtime.ts";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
config({ path: "/etc/fletch/offload-probe.env", quiet: true });
const exec = promisify(execFile);
assert.ok(process.env.FLETCH_CONTROL_MACHINE_ID, "Set the expected control host identity");
assert.equal((await readFile("/etc/machine-id", "utf8")).trim(), process.env.FLETCH_CONTROL_MACHINE_ID);
assert.equal(process.env.DOCKER_HOST, "ssh://fletch-executor");
const { sandboxArgs } = await import("../../lib/agent/sandbox.ts");
const { readCapacityResources, readCapacityPressure } = await import("../../lib/build/capacity.ts");
const { prepareBuildProcess, watchBuildProcess } = await import("../../lib/build/process-cancellation.ts");
const { withBuildCancellation } = await import("../../lib/build/cancellation.ts");
const { removeOwnedContainer } = await import("../../lib/build/durable/execution.ts");
const { createSourceCheckpoint, verifySourceCheckpoint } = await import("../../lib/build/durable/checkpoints.ts");
const workspace = await mkdtemp("/var/lib/fletch/workspaces/offload-acceptance-");
const archiveRoot = await mkdtemp("/var/lib/fletch/build-checkpoints/offload-acceptance-");
const image = process.env.FORGE_AGENT_IMAGE;
const name = `fletch-probe-${randomUUID()}`;
try {
  const resources = await readCapacityResources();
  assert.equal(resources.logicalCpus, 8);
  assert.equal(resources.cgroupCpuQuota, 6);
  assert.equal(resources.cgroupMemoryBytes, 24 * 1024 ** 3);
  const pressure = await readCapacityPressure(resources);
  await writeFile(`${workspace}/source.txt`, "Written on the original host.");
  const command = ["node", "-e", "const fs=require('fs');if(fs.readFileSync('/work/source.txt','utf8')!=='Written on the original host.')process.exit(1);fs.writeFileSync('/work/output.txt','Written by the remote sandbox.');"];
  await exec("docker", sandboxArgs({ image, workspace, name, network: "none" }, command), { timeout: 30_000 });
  assert.equal(await readFile(`${workspace}/output.txt`, "utf8"), "Written by the remote sandbox.");
  const controller = new AbortController();
  let cleanup;
  let closed;
  await withBuildCancellation(controller.signal, async function start() {
    const args = sandboxArgs({ image, workspace, name, network: "none" }, ["node", "-e", "require('fs').writeFileSync('/work/running.txt','ready');setInterval(()=>{},1000)"]);
    const prepared = await prepareBuildProcess("docker", args, { cwd: workspace, env: process.env }, name);
    const child = spawn("docker", prepared, { env: process.env, stdio: "ignore" });
    closed = new Promise(resolve => child.once("close", resolve));
    cleanup = watchBuildProcess(child, name);
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await readFile(`${workspace}/running.txt`, "utf8").catch(() => "") === "ready") break;
    await delay(100);
  }
  assert.equal(await readFile(`${workspace}/running.txt`, "utf8"), "ready");
  const endpoint = process.env.DOCKER_HOST;
  try {
    process.env.DOCKER_HOST = "ssh://fletch-executor-unavailable";
    await assert.rejects(removeOwnedContainer(name), "A transport failure must retain the unconfirmed sandbox.");
  } finally {
    process.env.DOCKER_HOST = endpoint;
  }
  const running = await exec("docker", ["inspect", "--format", "{{.State.Running}}", name]);
  assert.equal(running.stdout.trim(), "true");
  controller.abort(new Error("Controlled Stop test"));
  await closed;
  await cleanup.dispose();
  await assert.rejects(exec("docker", ["inspect", name]), error => /no such object/i.test(error.stderr));
  const checkpoint = await createSourceCheckpoint({ workspace, archiveRoot, buildId: randomUUID(), attempt: 1,
    stage: "remote_probe", async assertQuiescent() {
      await assert.rejects(exec("docker", ["inspect", name]), error => /no such object/i.test(error.stderr));
    } });
  await verifySourceCheckpoint(archiveRoot, checkpoint.hash);
  assert.equal(await readFile(`${workspace}/output.txt`, "utf8"), "Written by the remote sandbox.");
  console.log(JSON.stringify({ passed: true, resources, pressure, sharedSource: true, transportLossRetainsSandbox: true,
    stopConfirmed: true, checkpointVerified: true, checkpointFiles: checkpoint.manifest.files.length, paidCalls: 0 }));
} finally {
  // Failure to confirm remote cleanup intentionally keeps the source for review.
  await removeOwnedContainer(name);
  await rm(workspace, { recursive: true, force: true });
  await rm(archiveRoot, { recursive: true, force: true });
}
