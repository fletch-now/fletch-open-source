import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ToolOutput } from "./tool-output";
import { runTool } from "./foundry";

test("tool output shares a byte budget across stdout and stderr, preserving UTF-8", function output() {
  const output = new ToolOutput();
  for (const byte of Buffer.from("東京 ✓")) output.append("stdout", Buffer.from([byte]));
  assert.equal(output.read("stdout"), "東京 ✓");
  output.append("stderr", Buffer.alloc(16 * 1024 * 1024, "a"));
  assert.equal(output.exceeded, true);
  assert.equal(output.read("stderr"), "");
  output.append("stdout", Buffer.from("discarded"));
  assert.equal(output.read("stdout"), "東京 ✓");
});

test("noisy tools stop with an explicit failure and preserve workspace source", { timeout: 15_000 }, async function noisyTool() {
  const root = await mkdtemp(join(tmpdir(), "fletch-tool-output-"));
  const previous = { image: process.env.FORGE_AGENT_IMAGE, sandbox: process.env.FORGE_AGENT_SANDBOX, host: process.env.FORGE_UNSAFE_HOST_TOOLS };
  delete process.env.FORGE_AGENT_IMAGE;
  delete process.env.FORGE_AGENT_SANDBOX;
  process.env.FORGE_UNSAFE_HOST_TOOLS = "1";
  try {
    await writeFile(join(root, "source.sol"), "saved source");
    // Known local test program; generated application code still requires Docker.
    const result = await runTool(root, [process.execPath, "-e", "const b=Buffer.alloc(65536,'x'); function emit(){while(process.stdout.write(b)){} process.stdout.once('drain',emit)} emit()"]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /16 MiB output limit/);
    assert.equal(result.stdout, "");
    assert.equal(await readFile(join(root, "source.sol"), "utf8"), "saved source");
  } finally {
    if (previous.image === undefined) delete process.env.FORGE_AGENT_IMAGE;
    else process.env.FORGE_AGENT_IMAGE = previous.image;
    if (previous.sandbox === undefined) delete process.env.FORGE_AGENT_SANDBOX;
    else process.env.FORGE_AGENT_SANDBOX = previous.sandbox;
    if (previous.host === undefined) delete process.env.FORGE_UNSAFE_HOST_TOOLS;
    else process.env.FORGE_UNSAFE_HOST_TOOLS = previous.host;
    await rm(root, { force: true, recursive: true });
  }
});
