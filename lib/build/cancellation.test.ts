import "@/lib/test-server-only";
import assert from "node:assert/strict";
import childProcess, { ChildProcess, execFileSync, spawn } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { EventEmitter, getEventListeners, once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Pool, type PoolClient } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { analyseNeeds } from "@/lib/agent/needs-analysis";
import type { ProviderConfig } from "@/lib/agent/provider";
import { publishSite } from "@/lib/hosting/publish";
import { buildSignal, checkBuildCancellation, STOP_REQUESTED, withBuildCancellation } from "./cancellation";
import { runTool } from "./foundry";
import { BuildCleanupError, prepareBuildProcess, watchBuildProcess } from "./process-cancellation";
import { sandboxArgs } from "@/lib/agent/sandbox";
import { buildWebApp } from "./web";

const provider = { id: "kimi", model: "fixture", apiKey: "fixture", baseUrl: "http://127.0.0.1" } as ProviderConfig;

test("Stop aborts a silent planner without retry and leaves a concurrent build running", { timeout: 2000 }, async function planning() {
  const stopped = new AbortController();
  const other = new AbortController();
  let calls = 0;
  const waiting = withBuildCancellation(stopped.signal, () => analyseNeeds(provider, { prompt: "A simple page" }, false, async function request(_provider, _messages, options) {
    calls += 1;
    await delay(60_000, undefined, { signal: options?.signal });
    throw new Error("Unexpected completion");
  }));
  const rejected = assert.rejects(waiting, /Stopped by you/);
  const healthy = withBuildCancellation(other.signal, async function otherBuild() {
    await delay(10);
    checkBuildCancellation();
    return buildSignal();
  });
  stopped.abort(new Error(STOP_REQUESTED));
  await rejected;
  assert.equal(calls, 1);
  assert.equal(await healthy, other.signal);
  assert.equal(buildSignal(), undefined);
  assert.equal(getEventListeners(stopped.signal, "abort").length, 0);
});

test("an already stopped build cannot launch a tool", async function beforeStart() {
  const controller = new AbortController();
  controller.abort(new Error(STOP_REQUESTED));
  await assert.rejects(withBuildCancellation(controller.signal, () => runTool("/does-not-exist", ["must-not-start"])), /Stopped by you/);
});

test("failed container removal remains unconfirmed and exposes a retry instead of reporting cleanup complete", { timeout: 2000 }, async function cleanupFailure(t) {
  const controller = new AbortController();
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
  const closed = once(child, "close");
  let failing = true;
  let attempts = 0;
  // This case tests removal receipts; the following cases exercise real Docker.
  const execute = t.mock.method(childProcess, "execFile", function remove(command: string, args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) {
    assert.equal(command, "docker");
    assert.deepEqual(args, ["rm", "--force", "owned-fixture"]);
    attempts += 1;
    queueMicrotask(function receipt() { callback(failing ? new Error("daemon unavailable") : null, "", failing ? "daemon unavailable" : ""); });
    return new ChildProcess();
  });
  syncBuiltinESMExports();
  try {
    const cleanup = watchBuildProcess(child, "owned-fixture", undefined, controller.signal);
    controller.abort();
    assert.equal((await closed)[1], "SIGKILL");
    let failure: BuildCleanupError | undefined;
    await assert.rejects(cleanup.dispose(), function unconfirmed(error: unknown): boolean {
      assert.ok(error instanceof BuildCleanupError);
      failure = error;
      return true;
    });
    assert.equal(attempts, 3);
    failing = false;
    await failure!.retry();
    assert.equal(attempts, 4);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    child.kill("SIGKILL");
    execute.mock.restore();
    syncBuiltinESMExports();
  }
});

test("the publish helper's TERM handler kills and reaps its active descendant group", { timeout: 6000 }, async function publishDescendants() {
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-publish-process-"));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const source = await readFile("scripts/fletch-publish-site", "utf8");
    const preamble = source.slice(0, source.indexOf('\nSLUG="'));
    const script = join(root, "helper");
    await writeFile(script, `${preamble}\nrun_step sh -c 'trap "" TERM; echo $$ > pid; (sleep 2; echo late > late) & wait'\n`);
    child = spawn("bash", [script], { cwd: root, stdio: "ignore" });
    const closed = once(child, "close");
    let pid = "";
    for (let attempt = 0; attempt < 100 && !pid; attempt += 1) {
      pid = await readFile(join(root, "pid"), "utf8").catch(() => "");
      if (!pid) await delay(10);
    }
    assert.ok(pid);
    child.kill("SIGTERM");
    assert.equal((await closed)[0], 143);
    assert.throws(() => process.kill(Number(pid), 0), { code: "ESRCH" });
    await delay(1100);
    await assert.rejects(readFile(join(root, "late")), { code: "ENOENT" });
  } finally {
    child?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});

test("Stop removes the actual sandbox and its descendants while retaining workspace and other work", {
  skip: !process.env.FLETCH_TEST_SANDBOX_IMAGE, timeout: 10_000,
}, async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-tool-"));
  const previousImage = process.env.FORGE_AGENT_IMAGE;
  const previousSandbox = process.env.FORGE_AGENT_SANDBOX;
  process.env.FORGE_AGENT_IMAGE = process.env.FLETCH_TEST_SANDBOX_IMAGE;
  process.env.FORGE_AGENT_SANDBOX = "docker";
  const controller = new AbortController();
  try {
    const stopped = withBuildCancellation(controller.signal, () => runTool(root, ["sh", "-c", "hostname > container; echo source > retained; (sleep 1; echo late > late) & wait"]));
    const rejected = assert.rejects(stopped, /Stopped by you/);
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (await readFile(join(root, "container"), "utf8").catch(() => "")) break;
      await delay(10);
    }
    const container = (await readFile(join(root, "container"), "utf8")).trim();
    const sibling = withBuildCancellation(new AbortController().signal, () => runTool(root, ["sh", "-c", "echo sibling"]));
    controller.abort(new Error(STOP_REQUESTED));
    await rejected;
    assert.equal((await sibling).stdout.trim(), "sibling");
    assert.equal(await readFile(join(root, "retained"), "utf8"), "source\n");
    assert.throws(() => execFileSync("docker", ["inspect", container], { stdio: "ignore" }));
    await delay(1100);
    await assert.rejects(readFile(join(root, "late")), { code: "ENOENT" });
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    controller.abort();
    if (previousImage === undefined) delete process.env.FORGE_AGENT_IMAGE;
    else process.env.FORGE_AGENT_IMAGE = previousImage;
    if (previousSandbox === undefined) delete process.env.FORGE_AGENT_SANDBOX;
    else process.env.FORGE_AGENT_SANDBOX = previousSandbox;
    await rm(root, { recursive: true, force: true });
  }
});

test("Stop during Docker creation removes the container before any command starts", {
  skip: !process.env.FLETCH_TEST_SANDBOX_IMAGE, timeout: 10_000,
}, async function creationRace() {
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-create-"));
  const wrapper = join(root, "delayed-docker");
  const name = `fletch-stop-test-${randomUUID()}`;
  const controller = new AbortController();
  try {
    await writeFile(wrapper, "#!/bin/sh\nsleep 0.1\nexec docker \"$@\"\n");
    await chmod(wrapper, 0o755);
    const args = sandboxArgs({ image: process.env.FLETCH_TEST_SANDBOX_IMAGE!, workspace: root, name }, ["sh", "-c", "echo started > started"]);
    const created = withBuildCancellation(controller.signal, () => prepareBuildProcess(wrapper, args, { cwd: root }, name));
    const rejected = assert.rejects(created, /Stopped by you/);
    controller.abort(new Error(STOP_REQUESTED));
    await rejected;
    assert.throws(() => execFileSync("docker", ["inspect", name], { stdio: "ignore" }));
    await assert.rejects(readFile(join(root, "started")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stop interrupts the front-end build container before a hosted artifact can be returned", {
  skip: !process.env.FLETCH_TEST_WEB_IMAGE, timeout: 10_000,
}, async function webBuild() {
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-web-"));
  const previousImage = process.env.FORGE_AGENT_IMAGE;
  const previousSandbox = process.env.FORGE_AGENT_SANDBOX;
  const controller = new AbortController();
  process.env.FORGE_AGENT_IMAGE = process.env.FLETCH_TEST_WEB_IMAGE;
  process.env.FORGE_AGENT_SANDBOX = "docker";
  try {
    await writeFile(join(root, "index.html"), '<div id="app"></div><script type="module" src="/main.js"></script>');
    const values = Array.from({ length: 300_000 }, (_, index) => `"fixture ${index}"`).join(",");
    await writeFile(join(root, "main.js"), `document.querySelector('#app').textContent = [${values}].join(' ');`);
    const building = withBuildCancellation(controller.signal, () => buildWebApp(root, { chainId: 46630, rpcUrl: "https://rpc.example", explorerUrl: "https://explorer.example" }));
    const rejected = assert.rejects(building.then(function unexpected(result) { throw new Error(`Build returned before Stop: ${JSON.stringify(result)}`); }), /Stopped by you/);
    let container = "";
    const canonicalRoot = await realpath(root);
    for (let attempt = 0; attempt < 100 && !container; attempt += 1) {
      const candidates = execFileSync("docker", ["ps", "--filter", "name=fletch-web-", "--format", "{{.ID}}"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
      for (const candidate of candidates) {
        const inspected = JSON.parse(execFileSync("docker", ["inspect", candidate], { encoding: "utf8" }))[0] as { Mounts: Array<{ Source: string }> };
        if (inspected.Mounts.some((mount) => mount.Source === root || mount.Source === canonicalRoot)) container = candidate;
      }
      if (!container) await delay(10);
    }
    assert.ok(container, "The controlled front-end container must actually be running before Stop");
    controller.abort(new Error(STOP_REQUESTED));
    await rejected;
    assert.throws(() => execFileSync("docker", ["inspect", container], { stdio: "ignore" }));
    assert.ok((await readFile(join(root, "main.js"), "utf8")).includes("fixture 299999"));
  } finally {
    controller.abort();
    if (previousImage === undefined) delete process.env.FORGE_AGENT_IMAGE;
    else process.env.FORGE_AGENT_IMAGE = previousImage;
    if (previousSandbox === undefined) delete process.env.FORGE_AGENT_SANDBOX;
    else process.env.FORGE_AGENT_SANDBOX = previousSandbox;
    await rm(root, { recursive: true, force: true });
  }
});

test("Stop during publication restores the previous release and keeps the prepared source", { timeout: 2000 }, async function hosting(t) {
  // Lock contention has its own real PostgreSQL suite; this fixture isolates
  // cancellation of the publication helper and verification request.
  t.mock.method(Pool.prototype, "connect", async function lockConnection(): Promise<PoolClient> {
    return Object.assign(new EventEmitter(), {
      async query(sql: string): Promise<{ rows: Array<{ acquired: boolean }> }> {
        assert.match(sql, /pg_(try_advisory_lock|advisory_unlock)/);
        return { rows: [{ acquired: true }] };
      },
      release(): void {},
    }) as unknown as PoolClient;
  });
  const root = await mkdtemp(join(tmpdir(), "fletch-stop-host-"));
  const previousRoot = process.env.FORGE_SITES_ROOT;
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  const slug = "stop-fixture";
  let helperCalls = 0;
  const execute = t.mock.method(childProcess, "execFile", function helper(command: string, args: string[], _options: object, callback: (error: Error | null, stdout: string, stderr: string) => void) {
    assert.equal(command, "sudo");
    assert.deepEqual(args, ["-n", "/usr/local/bin/fletch-publish-site", slug]);
    helperCalls += 1;
    const child = new ChildProcess();
    queueMicrotask(function closed() {
      callback(null, "ok", "");
      child.emit("close", 0, null);
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const dist = join(root, "dist");
    const site = join(root, "sites", slug);
    await mkdir(dist);
    await mkdir(join(site, "previous"), { recursive: true });
    await writeFile(join(dist, "index.html"), "retained source");
    await symlink("previous", join(site, "current"));
    process.env.FORGE_SITES_ROOT = join(root, "sites");
    globalThis.fetch = async function verification(_input, init): Promise<Response> {
      assert.equal(await readlink(join(site, "current")), "next");
      controller.abort(new Error(STOP_REQUESTED));
      await delay(60_000, undefined, { signal: init?.signal ?? undefined });
      throw new Error("Unexpected verification");
    };
    const result = await withBuildCancellation(controller.signal, () => publishSite(slug, "next", dist, 15));
    assert.equal(result.ok, false);
    assert.equal(helperCalls, 1);
    assert.equal(await readlink(join(site, "current")), "previous");
    assert.equal(await readFile(join(site, "next", "index.html"), "utf8"), "retained source");
    await assert.rejects(withBuildCancellation(controller.signal, () => publishSite(slug, "after-stop", dist, 15)), /Stopped by you/);
    await assert.rejects(readFile(join(site, "after-stop", "index.html")), { code: "ENOENT" });
  } finally {
    globalThis.fetch = originalFetch;
    if (previousRoot === undefined) delete process.env.FORGE_SITES_ROOT;
    else process.env.FORGE_SITES_ROOT = previousRoot;
    execute.mock.restore();
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
});
