import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
async function invoke(args, extra = {}) {
  const directory = await mkdtemp(join(tmpdir(), "fletch-rolling-entry-"));
  try {
    await writeFile(join(directory, "ssh"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$FIXTURE_COMMAND"\n', { mode: 0o755 });
    let status = 0;
    try {
      await exec("bash", ["scripts/deploy.sh", ...args], { env: { ...process.env, FLETCH_HOST: "fixture.example", PATH: directory + ":" + process.env.PATH, FIXTURE_COMMAND: join(directory, "command"), ...extra } });
    } catch (error) { status = error.code; }
    const command = await readFile(join(directory, "command"), "utf8").catch(function absent(error) {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    return { status, command };
  } finally { await rm(directory, { recursive: true }); }
}
const valid = ["--id=release-example", "--root=/opt/fletch/web-releases/release-example", "--port=3002"];
test("default deploy sends only a prepared release to the rolling operator", async function () {
  const result = await invoke(valid, { DEPLOY_BUILD_WORKER: "0", DEPLOY_AGENT_IMAGE: "", DEPLOY_PROXY_BIND: "" });
  assert.equal(result.status, 0);
  assert.match(result.command, /scripts\/rolling\/web-deploy\.mjs/);
  assert.match(result.command, /--apply=yes/);
  assert.doesNotMatch(result.command, /systemctl|rsync|deploy-legacy/);
});
test("missing or injected candidate identifiers never reach SSH", async function () {
  for (const args of [[], [...valid, "--id=bad;touch /tmp/injected"], [...valid, "--root=/opt/fletch/../app"], [...valid, "--port=3000"]]) {
    const result = await invoke(args);
    assert.notEqual(result.status, 0);
    assert.equal(result.command, null);
  }
});
test("worker updates cannot enter through the web deploy command", async function () {
  const result = await invoke(valid, { DEPLOY_BUILD_WORKER: "1" });
  assert.notEqual(result.status, 0);
  assert.equal(result.command, null);
});
