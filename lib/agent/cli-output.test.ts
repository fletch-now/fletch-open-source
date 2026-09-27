import assert from "node:assert/strict";
import { test } from "node:test";
import { CliOutput } from "./cli-output";
import { parseKimiLine } from "./cli-events";

test("CLI output retains split Unicode and the final unterminated event", function unicode() {
  const output = new CliOutput((line) => parseKimiLine(JSON.parse(line), "fixture"));
  const bytes = Buffer.from(JSON.stringify({ role: "assistant", content: "Wallet ✓ 東京" }));
  for (const byte of bytes) output.write(Buffer.from([byte]));
  assert.equal(output.length, 0);
  output.end();
  assert.deepEqual(output.shift(), { kind: "text", text: "Wallet ✓ 東京" });
});

test("a slow event consumer applies backpressure without losing ordered events", function backlog() {
  const output = new CliOutput((line) => [{ kind: "text", text: line }]);
  let next = 0;
  const seen: string[] = [];
  let pauses = 0;
  while (next < 10_000 || output.length) {
    while (next < 10_000 && !output.full) output.write(Buffer.from(`${next++}\n`));
    if (output.full) pauses++;
    assert.ok(output.length <= 128);
    const event = output.shift();
    if (event) seen.push(event.text!);
  }
  assert.ok(pauses > 0);
  assert.deepEqual(seen, Array.from({ length: 10_000 }, (_, index) => String(index)));
});

test("large queued events pause before the event-count limit and resume on drain", function bytes() {
  const output = new CliOutput(() => []);
  while (!output.full) output.push({ kind: "text", text: "a".repeat(64 * 1024) });
  assert.ok(output.length < 128);
  while (output.length) output.shift();
  assert.equal(output.full, false);
});

test("a stream without newlines cannot grow a worker's partial-line buffer indefinitely", function lineLimit() {
  const output = new CliOutput(() => []);
  for (let index = 0; index < 16; index++) output.write(Buffer.alloc(64 * 1024, "a"));
  assert.throws(() => output.write(Buffer.from("a")), /larger than 1 MiB/);
});

test("one assistant line may cross the queue high-water mark without dropping tool events", function multipleEvents() {
  const output = new CliOutput((line) => parseKimiLine(JSON.parse(line), "fixture"));
  const calls = Array.from({ length: 256 }, (_, index) => ({ id: String(index), function: { name: "ReadFile", arguments: JSON.stringify({ path: `file-${index}` }) } }));
  output.write(Buffer.from(`${JSON.stringify({ role: "assistant", tool_calls: calls })}\n`));
  assert.equal(output.full, true);
  assert.equal(output.length, calls.length);
  for (const call of calls) assert.equal(output.shift()?.toolCallId, `fixture:${call.id}`);
  assert.equal(output.full, false);
});

test("Stop drains an exited CLI pipe and removes its credential file while the event consumer is stalled", { timeout: 10_000 }, async function stoppedProducer(t) {
  await import("@/lib/test-server-only");
  const { mkdtemp, writeFile, rm, access } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { setTimeout: delay } = await import("node:timers/promises");
  const root = await mkdtemp(join(tmpdir(), "fletch-cli-drain-"));
  const env = {
    PATH: `${root}:${process.env.PATH}`,
    FORGE_AGENT_SANDBOX: "docker",
    FORGE_AGENT_IMAGE: "fixture-no-real-container",
    FORGE_PROXY_BIND: "127.0.0.1",
    FORGE_PROXY_PORT: "0",
  };
  const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async function cleanup() {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  // Only the Docker transport is replaced. The real runner owns the child,
  // stdout queue, Stop callback, close handler and credential-file cleanup.
  await writeFile(join(root, "docker"), `#!${process.execPath}
if (process.argv[2] === "start") {
  const line = JSON.stringify({ role: "assistant", content: "fixture event" }) + "\\n";
  process.stdout.write(line.repeat(10000));
  setInterval(() => {}, 1000);
}
`, { mode: 0o700 });
  const { runAgentCli } = await import("./cli-runner");
  const { closeCredentialProxy } = await import("./credential-proxy");
  t.after(closeCredentialProxy);
  let stop: (() => void) | undefined;
  const iterator = runAgentCli({
    workspace: root, prompt: "local transport fixture",
    provider: { id: "kimi", apiKey: "fixture-unused", baseUrl: "http://127.0.0.1:1", model: "fixture", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true },
    onStop(callback) { stop = callback; },
  })[Symbol.asyncIterator]();
  const config = join(root, ".agent-home", ".kimi-code", "config.toml");
  try {
    assert.equal((await iterator.next()).value?.kind, "text");
    await access(config);
    await delay(100);
    assert.ok(stop);
    stop();
    // Do not consume or return the generator: only close can remove this file.
    let removed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await access(config); }
      catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        removed = true;
        break;
      }
      await delay(20);
    }
    assert.equal(removed, true, "child close must finish even while the queue remains full");
    const events = [];
    for (let next = await iterator.next(); !next.done; next = await iterator.next()) events.push(next.value);
    assert.ok(events.some((event) => event.kind === "error"), "a stopped producer must not report successful completion");
    assert.equal(events.some((event) => event.kind === "boundary"), false);
  } finally {
    stop?.();
    await iterator.return?.();
  }
});
