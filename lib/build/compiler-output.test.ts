import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { compile, runCompiler, runTests, runTool, writeFoundryConfig } from "./foundry";

test("real forge-std compilation keeps bulk artifacts in the sandbox and preserves original compiler diagnostics", {
  skip: !process.env.FLETCH_TEST_WEB_IMAGE, timeout: 90_000,
}, async function compilerOutput(t) {
  const root = await mkdtemp(join(tmpdir(), "fletch-compiler-output-"));
  const original = { image: process.env.FORGE_AGENT_IMAGE, sandbox: process.env.FORGE_AGENT_SANDBOX };
  process.env.FORGE_AGENT_IMAGE = process.env.FLETCH_TEST_WEB_IMAGE;
  process.env.FORGE_AGENT_SANDBOX = "docker";
  try {
    await mkdir(join(root, "contracts"));
    await mkdir(join(root, "test"));
    const source = "pragma solidity ^0.8.28; contract App { function value() public pure returns (uint) { return 1; } }";
    await writeFile(join(root, "contracts", "App.sol"), source);
    await writeFile(join(root, "test", "App.t.sol"), 'pragma solidity ^0.8.28; import "forge-std/Test.sol"; import "../contracts/App.sol"; contract AppTest is Test { function testValue() public { assertEq(new App().value(), 1); } }');
    // Agent files must not shadow Python's standard library used by the wrapper.
    await writeFile(join(root, "json.py"), 'raise RuntimeError("workspace Python module executed")');
    await writeFoundryConfig(root);

    async function originalCompiler(): Promise<{ code: number; stderr: string; bytes: number; errors: unknown[] }> {
      // Read the unmodified compiler output inside the same real sandbox. Only
      // the reference verdict and byte count leave it, not its large artifacts.
      const result = await runTool(root, ["python3", "-I", "-c", `import json, subprocess
result = subprocess.run(["forge", "build", "--force", "--json", "--build-info"], capture_output=True)
raw = result.stdout
try:
    errors = json.loads(raw[raw.index(b"{"):]).get("errors", [])
except ValueError:
    errors = []
print(json.dumps({"code": result.returncode, "stderr": result.stderr.decode(), "bytes": len(raw), "errors": errors}))
`]);
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(result.stdout);
    }

    await t.test("normal dependency output exceeds the host limit while compilation and test evidence remain intact", async function normalBuild() {
      const reference = await originalCompiler();
      assert.equal(reference.code, 0, reference.stderr);
      assert.ok(reference.bytes > 16 * 1024 * 1024, `fixture must exercise oversized normal output; saw ${reference.bytes}`);
      const run = await runCompiler(root);
      assert.equal(run.code, reference.code);
      assert.equal(run.stderr, reference.stderr);
      assert.deepEqual(JSON.parse(run.stdout), { errors: reference.errors });
      assert.ok(Buffer.byteLength(run.stdout) < 16 * 1024 * 1024);
      t.diagnostic(`Original compiler stdout: ${reference.bytes} bytes; diagnostics sent to host: ${Buffer.byteLength(run.stdout)} bytes.`);
      const report = await compile(root, ["contracts/App.sol"]);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual(report.contracts.map(({ name }) => name), ["App"]);
      assert.equal(report.warnings, reference.errors.length);
      assert.ok((await readdir(join(root, "out", "build-info"))).some((file) => file.endsWith(".json")));
      const tests = await runTests(root);
      assert.equal(tests?.exitCode, 0);
      assert.equal(tests?.passed, 1);
      assert.equal(await readFile(join(root, "contracts", "App.sol"), "utf8"), source);
    });

    await t.test("compiler failure keeps its exact exit and diagnostics without returning contract artifacts", async function failedBuild() {
      await writeFile(join(root, "contracts", "App.sol"), "pragma solidity ^0.8.28; contract App { function value() public pure returns (uint) { return missing; } }");
      const reference = await originalCompiler();
      assert.notEqual(reference.code, 0);
      const run = await runCompiler(root);
      assert.equal(run.code, reference.code);
      assert.equal(run.stderr, reference.stderr);
      if (run.stdout.trim()) assert.deepEqual(JSON.parse(run.stdout), { errors: reference.errors });
      const report = await compile(root, ["contracts/App.sol"]);
      assert.equal(report.ok, false);
      assert.equal(report.contracts.length, 0);
      assert.ok(report.errors.length > 0);
      assert.match(report.errors.map(({ message }) => message).join(" "), /missing|identifier|compil/i);
    });
  } finally {
    if (original.image === undefined) delete process.env.FORGE_AGENT_IMAGE;
    else process.env.FORGE_AGENT_IMAGE = original.image;
    if (original.sandbox === undefined) delete process.env.FORGE_AGENT_SANDBOX;
    else process.env.FORGE_AGENT_SANDBOX = original.sandbox;
    await rm(root, { recursive: true, force: true });
  }
});
