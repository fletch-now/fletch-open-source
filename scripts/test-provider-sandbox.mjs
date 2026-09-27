// Explicit, paid-call-free integration smoke: real Docker/Kimi CLI, local fake provider only.
import "../lib/test-server-only.ts";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
if (!process.env.FLETCH_TEST_DATABASE_URL) throw new Error("Set a disposable FLETCH_TEST_DATABASE_URL.");
process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
process.env.FORGE_AGENT_SANDBOX = "docker";
process.env.FORGE_AGENT_IMAGE = "fletch-agent:latest";
process.env.FORGE_AGENT_BIN = "kimi";
process.env.FORGE_PROXY_BIND = "0.0.0.0";
process.env.FORGE_AGENT_TIMEOUT_MS = "60000";
const reserve = createServer();
await new Promise((resolve) => reserve.listen(0, "0.0.0.0", resolve));
process.env.FORGE_PROXY_PORT = String(reserve.address().port);
await new Promise((resolve) => reserve.close(resolve));
const { runAgentCli } = await import("../lib/agent/cli-runner.ts");
const { close } = await import("../lib/db/index.ts");
const referenceData = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
let providerId = "kimi";
let requests = 0;
let providerFailure = null;
const upstream = createServer(function handle(req, res) {
  void fakeProvider(req, res).catch(function failed(error) {
    providerFailure = error;
    res.writeHead(500);
    res.end('{"error":{"message":"Local test fixture failed"}}');
  });
});
async function fakeProvider(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests += 1;
  const messages = body.input ?? body.messages;
  const visualMessages = messages.filter((message) => message.role === "user" && Array.isArray(message.content) && message.content.some((part) => ["image", "input_image", "image_url"].includes(part.type)));
  assert.equal(visualMessages.length, 1);
  const reference = visualMessages[0].content.find((part) => ["image", "input_image", "image_url"].includes(part.type));
  if (providerId === "anthropic") assert.deepEqual(reference, { type: "image", source: { type: "base64", media_type: "image/png", data: referenceData } });
  else if (providerId === "openai") assert.deepEqual(reference, { type: "input_image", image_url: `data:image/png;base64,${referenceData}`, detail: "auto" });
  else assert.deepEqual(reference, { type: "image_url", image_url: { url: `data:image/png;base64,${referenceData}` } });
  const tools = body.tools ?? [];
  const tool = tools.find((tool) => /(shell|bash)/i.test(tool.name ?? tool.function?.name ?? ""));
  const name = tool?.name ?? tool?.function?.name;
  const args = { command: `printf sandbox-${providerId} > acceptance.txt`, timeout: 1000 };
  console.log(JSON.stringify({ provider: providerId, request: requests, path: req.url, shellTool: name, tools: tools.map((tool) => tool.name ?? tool.function?.name) }));
  if (!name || requests > 3) { res.writeHead(400); res.end('{"error":{"message":"Unexpected sandbox request"}}'); return; }
  let reply;
  if (providerId === "kimi") reply = { id: `mock-${requests}`, model: body.model, choices: [{ index: 0, message: requests === 1 ? { role: "assistant", content: "", reasoning_content: "Write the requested proof file.", tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { role: "assistant", content: "Completed the proof file.", reasoning_content: "The tool succeeded." }, finish_reason: requests === 1 ? "tool_calls" : "stop" }], usage: { prompt_tokens: 30, completion_tokens: 10 } };
  else if (providerId === "openai") reply = { id: `resp_${requests}`, status: "completed", model: body.model, output: requests === 1 ? [{ type: "function_call", id: "fc_1", call_id: "call_1", name, arguments: JSON.stringify(args) }] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Completed the proof file." }] }], usage: { input_tokens: 30, output_tokens: 10 } };
  else reply = { id: `msg_${requests}`, type: "message", role: "assistant", model: body.model, content: requests === 1 ? [{ type: "tool_use", id: "call_1", name, input: args }] : [{ type: "text", text: "Completed the proof file." }], stop_reason: requests === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 30, output_tokens: 10 } };
  res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(reply));
}
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
try {
  for (const id of ["kimi", "openai", "anthropic"]) {
    providerId = id; requests = 0; providerFailure = null;
    const workspace = await mkdtemp(join(tmpdir(), "fletch-provider-smoke-"));
    const events = [];
    try {
      for await (const event of runAgentCli({ workspace, prompt: "Write acceptance.txt using the Bash tool, then finish.", provider: { id, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: "fake-local-provider-key", model: "selected-model", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: false, capabilities: { text: true, tools: true, images: true }, referenceImages: [{ kind: "image", name: "reference.png", mediaType: "image/png", data: referenceData }] } })) { events.push(event); if (event.kind === "error") console.log(event); }
      if (providerFailure) throw providerFailure;
      assert.equal(events.some((event) => event.kind === "error"), false, JSON.stringify(events));
      assert.equal(await readFile(join(workspace, "acceptance.txt"), "utf8"), `sandbox-${id}`);
      assert.equal(requests, 2);
      assert.equal(JSON.stringify(events).includes("fake-local-provider-key"), false);
      console.log(`PASS ${id}: real Docker CLI executed a complete tool request, continued and finished; exact native image bytes reached both selected-provider requests.`);
    } finally { await rm(workspace, { recursive: true, force: true }); }
  }
} finally {
  upstream.closeAllConnections(); await new Promise((resolve) => upstream.close(resolve));
  const proxy = globalThis.__fletchCredentialProxy?.server;
  if (proxy) { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
  await close();
}
