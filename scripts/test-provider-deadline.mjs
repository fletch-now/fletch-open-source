// No paid calls: the installed Docker CLI reaches a local stalled provider once.
import "../lib/test-server-only.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (!process.env.FLETCH_TEST_DATABASE_URL) throw new Error("Set a disposable FLETCH_TEST_DATABASE_URL.");
process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
process.env.FORGE_AGENT_SANDBOX = "docker";
process.env.FORGE_AGENT_IMAGE ??= "fletch-agent:latest";
process.env.FORGE_AGENT_BIN = "kimi";
process.env.FORGE_PROXY_BIND = "0.0.0.0";
process.env.FORGE_AGENT_TIMEOUT_MS = "60000";
process.env.FORGE_MODEL_REQUEST_TIMEOUT_MS = "1000";
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "0.0.0.0", resolve));
process.env.FORGE_PROXY_PORT = String(reserve.address().port);
await new Promise((resolve) => reserve.close(resolve));
const { runAgentCli } = await import("../lib/agent/cli-runner.ts");
const { close } = await import("../lib/db/index.ts");
let requests = 0;
const upstream = createServer(function stall(req) {
  requests += 1;
  req.resume();
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const workspace = await mkdtemp(join(tmpdir(), "fletch-deadline-smoke-"));
const events = [];
const startedAt = Date.now();
try {
  for await (const event of runAgentCli({ workspace, prompt: "Reply with ready.", provider: {
    id: "kimi", baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fake-deadline-secret",
    model: "selected-model", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: false,
  } })) events.push(event);
  assert.equal(requests, 1, "A terminal deadline must not retry a potentially billed generation");
  assert.equal(events.some((event) => event.kind === "error"), true);
  assert.match(JSON.stringify(events), /exceeded the response time limit/);
  assert.equal(JSON.stringify(events).includes("fake-deadline-secret"), false);
  assert.ok(Date.now() - startedAt < 30_000, "The CLI must terminate before its overall build timeout");
  console.log(`PASS installed Docker CLI: one upstream request, terminal deadline, no retry, ${Date.now() - startedAt}ms.`);
} finally {
  upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
  const proxy = globalThis.__fletchCredentialProxy?.server;
  if (proxy) { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
  await rm(workspace, { recursive: true, force: true });
  await close();
}
