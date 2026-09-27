import "@/lib/test-server-only";
import assert from "node:assert/strict";
import childProcess, { execFileSync } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildWebApp } from "./web";
import { ToolOutput } from "./tool-output";

const env = { chainId: 46630, rpcUrl: "https://rpc.example", explorerUrl: "https://explorer.example" };

test("frontend output is bounded without losing normal build verdicts or sandbox cleanup", {
  skip: !process.env.FLETCH_TEST_WEB_IMAGE, timeout: 60_000,
}, async function frontend(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-web-output-"));
  const image = process.env.FLETCH_TEST_WEB_IMAGE!;
  const previous = { image: process.env.FORGE_AGENT_IMAGE, sandbox: process.env.FORGE_AGENT_SANDBOX };
  process.env.FORGE_AGENT_IMAGE = image;
  process.env.FORGE_AGENT_SANDBOX = "docker";
  t.after(async function cleanup() {
    for (const [key, value] of Object.entries({ FORGE_AGENT_IMAGE: previous.image, FORGE_AGENT_SANDBOX: previous.sandbox })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(join(root, "index.html"), '<div id="app">東京 ✓</div><script type="module" src="/main.js"></script>');
  await writeFile(join(root, "main.js"), 'document.querySelector("#app").textContent += " ready";');

  await t.test("real Vite success preserves its output and template receipt", async () => {
    const result = await buildWebApp(root, env);
    assert.equal(result.ok, true);
    if (result.ok) { assert.ok(result.bytes > 0); assert.match(result.templateVersion ?? "", /^\d+\.\d+\.\d+$/); }
    assert.match(await readFile(join(root, "dist/index.html"), "utf8"), /東京 ✓/);
  });
  await t.test("real Vite failure remains a failure with its useful diagnostic", async () => {
    await writeFile(join(root, "main.js"), 'import missing from "./fixture-module-that-does-not-exist.js"; console.log(missing);');
    const result = await buildWebApp(root, env);
    assert.equal(result.ok, false);
    if (!result.ok && !result.skipped) assert.match(result.error, /fixture-module-that-does-not-exist|Could not resolve/i);
  });
  await t.test("combined noisy streams stop the actual owned container and cannot publish a prepared dist", async function noisy(t) {
    // Replace only the command inside the normal locked-down Docker create call.
    // This known fixture runs inside Docker; application code never runs on the host.
    await writeFile(join(root, "output-fixture.mjs"), `import fs from 'node:fs'; import os from 'node:os'; import {once} from 'node:events';
fs.writeFileSync('/work/fixture-container',os.hostname()); fs.mkdirSync('/work/dist',{recursive:true}); fs.writeFileSync('/work/dist/index.html','must not be accepted');
console.log('FLETCH_TEMPLATE_VERSION=2.0.2');
const chunk=Buffer.alloc(65536,'x');
for (const stream of [process.stdout,process.stderr]) for(let i=0;i<144;i++) if(!stream.write(chunk)) await once(stream,'drain');
setTimeout(()=>fs.writeFileSync('/work/unexpected-late-write','bad'),30000);`);
    const execute = childProcess.execFile;
    let container = "";
    const removal: string[] = [];
    const calls = t.mock.method(childProcess, "execFile", function fixture(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }, callback: (error: childProcess.ExecFileException | null, stdout: string, stderr: string) => void) {
      if (command === "docker" && Array.isArray(args) && args[0] === "create") {
        container = String(args[args.indexOf("--name") + 1]);
        assert.ok(args.includes("--network=none"));
        assert.ok(args.includes("--read-only"));
        assert.ok(args.includes("--cap-drop=ALL"));
        const index = args.indexOf(image);
        assert.ok(index > 0);
        return execute(command, [...args.slice(0, index + 1), "node", "/work/output-fixture.mjs"], options, callback);
      }
      if (command === "docker" && Array.isArray(args) && args[0] === "rm") removal.push(String(args.at(-1)));
      return execute(command, args, options, callback);
    });
    const append = ToolOutput.prototype.append;
    let retainedBytes = 0;
    const received = { stdout: 0, stderr: 0 };
    const buffers = t.mock.method(ToolOutput.prototype, "append", function bounded(this: ToolOutput, stream: "stdout" | "stderr", chunk: Buffer) {
      received[stream] += chunk.length;
      append.call(this, stream, chunk);
      if (!this.exceeded) retainedBytes += chunk.length;
      assert.ok(retainedBytes <= 16 * 1024 * 1024);
    });
    syncBuiltinESMExports();
    try {
      const result = await buildWebApp(root, env);
      assert.deepEqual(result, { ok: false, skipped: false, error: "The front-end build exceeded the 16 MiB output limit and was stopped. Saved source is retained." });
      assert.ok(received.stdout > 0 && received.stderr > 0);
      assert.ok(received.stdout + received.stderr > 16 * 1024 * 1024);
      assert.deepEqual(removal, [container]);
      assert.throws(() => execFileSync("docker", ["inspect", container], { stdio: "ignore" }));
      assert.equal(await readFile(join(root, "dist/index.html"), "utf8"), "must not be accepted");
      assert.match(await readFile(join(root, "index.html"), "utf8"), /東京 ✓/);
      await assert.rejects(readFile(join(root, "unexpected-late-write")), { code: "ENOENT" });
    } finally { calls.mock.restore(); buffers.mock.restore(); syncBuiltinESMExports(); }
  });
});
