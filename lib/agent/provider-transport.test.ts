import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync, deflateSync, brotliCompressSync } from "node:zlib";
import { ModelHttpError, ModelOutputError, newTransportContext, providerReply, providerRequest, requestAgent, type AgentRequest } from "@/lib/agent/provider-transport";
import type { ProviderConfig } from "@/lib/agent/provider";

function config(id: ProviderConfig["id"]): ProviderConfig { return { id, baseUrl: "https://provider.invalid/v1", apiKey: "test-secret-must-never-escape", model: "chosen-model", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true }; }
const request: AgentRequest = { model: "chosen-model", messages: [
  { role: "system", content: "Build safely" }, { role: "user", content: "Read the file" },
  { role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"app.ts"}' } }] },
  { role: "tool", tool_call_id: "call_1", content: "file content" },
], tools: [{ type: "function", function: { name: "read_file", parameters: { type: "object", properties: { path: { type: "string" } } } } }], max_tokens: 999999 };

test("Anthropic Messages preserves tool IDs and groups results under user messages", function anthropic() {
  const upstream = providerRequest(config("anthropic"), request, newTransportContext());
  assert.equal(upstream.path, "/messages"); assert.equal(upstream.headers.authorization, undefined);
  assert.equal(upstream.headers["x-api-key"], config("anthropic").apiKey);
  assert.equal(upstream.body.max_tokens, 16384);
  assert.deepEqual(upstream.body.messages, [
    { role: "user", content: [{ type: "text", text: "Read the file" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "app.ts" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file content" }] },
  ]);
});
test("OpenAI Responses preserves reasoning continuation with complete calls", function responses() {
  const context = newTransportContext();
  const items = [{ type: "reasoning", id: "rs_1", encrypted_content: "encrypted-reasoning" }, { type: "function_call", id: "fc_1", call_id: "call_1", name: "read_file", arguments: '{"path":"app.ts"}' }];
  const reply = providerReply(config("openai"), { id: "resp_1", status: "completed", output: items, usage: { input_tokens: 41, output_tokens: 12 } }, context);
  assert.equal(reply.message.tool_calls?.[0].id, "call_1");
  const upstream = providerRequest(config("openai"), request, context);
  assert.equal(upstream.path, "/responses"); assert.equal(upstream.body.store, false);
  assert.deepEqual((upstream.body.input as unknown[]).slice(2), [...items, { type: "function_call_output", call_id: "call_1", output: "file content" }]);
  assert.deepEqual(reply.usage, { inputTokens: 41, outputTokens: 12 });
});
test("Kimi retains native reasoning and unknown usage remains null", function kimi() {
  const reply = providerReply(config("kimi"), { choices: [{ message: { role: "assistant", content: "Done", reasoning_content: "reasoning" }, finish_reason: "stop" }] }, newTransportContext());
  assert.equal(reply.message.reasoning_content, "reasoning"); assert.equal(reply.usage, null);
  const upstream = providerRequest(config("kimi"), request, newTransportContext());
  assert.equal(upstream.path, "/chat/completions"); assert.equal(upstream.body.model, "chosen-model");
});
test("compacted history releases retired reasoning but retains current tool exchanges", function compacted() {
  const context = newTransportContext();
  context.responseItems.set("retired", [{ type: "reasoning", encrypted_content: "old" }]);
  context.responseItems.set("call_1", [{ type: "function_call", call_id: "call_1", name: "read_file", arguments: '{}' }]);
  providerRequest(config("openai"), request, context);
  assert.equal(context.responseItems.has("retired"), false);
  assert.equal(context.responseItems.has("call_1"), true);
  providerRequest(config("openai"), { model: "chosen-model", messages: [{ role: "user", content: "Saved summary. Next task." }] }, context);
  assert.equal(context.responseItems.size, 0);
});
test("truncated and malformed tool arguments are never delivered", function partial() {
  assert.throws(() => providerReply(config("openai"), { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [{ type: "function_call", call_id: "call_1", name: "shell", arguments: '{"command":' }] }, newTransportContext()), /output limit/);
  assert.throws(() => providerReply(config("anthropic"), { content: [{ type: "tool_use", id: "call_1", name: "shell", input: {} }], stop_reason: "max_tokens" }, newTransportContext()), /output limit/);
  assert.throws(() => providerReply(config("kimi"), { choices: [{ message: { tool_calls: [{ id: "call", function: { name: "shell", arguments: "{" } }] } }] }, newTransportContext()), /incomplete tool/);
});
test("complete source writes above 32 KiB survive every provider adapter", function largeWrite() {
  const input = { path: "src/GameView.tsx", content: "// Hex tile: 城\n".repeat(2500) };
  assert.ok(Buffer.byteLength(input.content) > 32 * 1024);
  const args = JSON.stringify(input);
  const responses = {
    kimi: { choices: [{ finish_reason: "tool_calls", message: { tool_calls: [{ id: "write", function: { name: "write_file", arguments: args } }] } }] },
    openai: { status: "completed", output: [{ type: "function_call", call_id: "write", name: "write_file", arguments: args }] },
    anthropic: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "write", name: "write_file", input }] },
  };
  for (const id of ["kimi", "openai", "anthropic"] as const) {
    const reply = providerReply(config(id), responses[id], newTransportContext());
    assert.deepEqual(JSON.parse(reply.message.tool_calls![0].function.arguments), input);
    assert.equal(reply.message.tool_calls![0].id, "write");
  }
});
test("native HTTP preserves redaction, decoded bounds, redirects and cancellation", async function transport() {
  let mode = "failure";
  let reached: (() => void) | undefined;
  let redirected = false;
  const server = createServer(function provider(req, res) {
    req.resume();
    if (req.url === "/redirected") redirected = true;
    if (mode === "waiting") { reached?.(); return; }
    if (mode === "failure") { res.writeHead(401); res.end(config("kimi").apiKey); return; }
    if (mode === "redirect") { res.writeHead(302, { location: "/redirected" }); res.end(); return; }
    const text = mode === "oversized" ? "x".repeat(16 * 1024 * 1024) : config("kimi").apiKey;
    const json = Buffer.from(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: "stop" }] }));
    if (mode === "gzip" || mode === "oversized") { res.setHeader("content-encoding", "gzip"); res.end(gzipSync(json)); }
    else if (mode === "deflate") { res.setHeader("content-encoding", "deflate"); res.end(deflateSync(json)); }
    else if (mode === "br") { res.setHeader("content-encoding", "br"); res.end(brotliCompressSync(json)); }
    else res.end(json);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = { ...config("kimi"), baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
  function call(signal = new AbortController().signal) { return requestAgent(provider, request, newTransportContext(), signal); }
  try {
    await assert.rejects(call(), { message: "The model provider returned 401." });
    for (const encoding of ["identity", "gzip", "deflate", "br"]) {
      mode = encoding;
      assert.equal((await call()).message.content, "[redacted]", encoding);
    }
    mode = "oversized";
    await assert.rejects(call(), /response exceeds the build limit/);
    mode = "redirect";
    await assert.rejects(call(), /returned 302/);
    assert.equal(redirected, false, "Never follow provider redirects with credentials");
    mode = "waiting";
    const controller = new AbortController();
    const started = new Promise<void>((resolve) => { reached = resolve; });
    const pending = call(controller.signal);
    await started;
    controller.abort();
    await assert.rejects(pending, /stopped or timed out/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("native vision payloads retain exact bytes and use only the selected model", function vision() {
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  for (const id of ["kimi", "openai", "anthropic"] as const) {
    const provider: ProviderConfig = { ...config(id), capabilities: { text: true, tools: true, images: true }, referenceImages: [{ kind: "image", name: "reference.png", mediaType: "image/png", data }] };
    const native = providerRequest(provider, request, newTransportContext());
    assert.equal(native.body.model, "chosen-model");
    const input = (native.body.input ?? native.body.messages) as Array<{ role: string; content: Array<Record<string, unknown>> }>;
    const image = input.find((message) => message.role === "user")!.content[1];
    if (id === "anthropic") assert.deepEqual(image, { type: "image", source: { type: "base64", media_type: "image/png", data } });
    else if (id === "openai") assert.deepEqual(image, { type: "input_image", image_url: `data:image/png;base64,${data}`, detail: "auto" });
    else assert.deepEqual(image, { type: "image_url", image_url: { url: `data:image/png;base64,${data}` } });
    assert.equal(JSON.stringify(native.body).includes(provider.apiKey), false);
    assert.throws(() => providerRequest({ ...provider, capabilities: { text: true, tools: true, images: false } }, request, newTransportContext()), /does not support/);
    assert.throws(() => providerRequest({ ...provider, gatewayId: "gw_old" }, request, newTransportContext()), /does not support/);
  }
  assert.equal(typeof request.messages[1].content, "string", "Never mutate CLI session messages");
});

test("a resumed conversation receives current images only on its newest user turn", function currentTurn() {
  const history: AgentRequest = { model: "chosen-model", messages: [
    { role: "user", content: "The old build without images" },
    { role: "assistant", content: "Previous build complete" },
    ...request.messages.slice(1),
  ] };
  for (const id of ["kimi", "openai", "anthropic"] as const) {
    const provider: ProviderConfig = { ...config(id), capabilities: { text: true, tools: true, images: true }, referenceImages: [{ kind: "image", name: "current.png", mediaType: "image/png", data: "current-image-bytes" }] };
    const upstream = providerRequest(provider, history, newTransportContext());
    const input = (upstream.body.input ?? upstream.body.messages) as Array<{ role: string; content: unknown }>;
    assert.equal(JSON.stringify(input[0]).includes("current-image-bytes"), false);
    assert.equal(JSON.stringify(input[2]).includes("current-image-bytes"), true);
    assert.equal(JSON.stringify(upstream.body).split("current-image-bytes").length, 2);
  }
  assert.equal(history.messages[2].content, "Read the file");
});


test("output-limit errors carry definitive receipt and usage, never partial arguments", function outputReceipt() {
  const secretPartial = '{"path":"App.tsx","content":"' + "x".repeat(40_000);
  for (const usage of [{ prompt_tokens: 91, completion_tokens: 8192 }, undefined]) {
    assert.throws(() => providerReply(config("kimi"), { id: "known-returned-response", usage,
      choices: [{ finish_reason: "length", message: { tool_calls: [{ id: "write", function: { name: "write_file", arguments: secretPartial } }] } }],
    }, newTransportContext()), function known(error: unknown) {
      assert.ok(error instanceof ModelOutputError);
      assert.equal(error.code, "output_limit");
      assert.deepEqual(error.receipt, { providerRequestId: "known-returned-response", model: "chosen-model", finishReason: "length",
        usage: usage ? { inputTokens: 91, outputTokens: 8192 } : null });
      assert.ok(!JSON.stringify(error).includes(secretPartial));
      return true;
    });
  }
  assert.throws(() => providerReply(config("kimi"), { choices: [{ finish_reason: "tool_calls", message: {
    tool_calls: [{ id: "write", function: { name: "write_file", arguments: "{" } }],
  } }] }, newTransportContext()), function malformed(error: unknown) {
    assert.ok(error instanceof ModelOutputError);
    assert.equal(error.code, "incomplete_tool_request", "Malformed output without a length finish must not qualify for continuation");
    return true;
  });
});


test("an incomplete provider response without an explicit output limit is not recoverable", function unknownIncomplete() {
  for (const reason of [undefined, "content_filter"]) {
    assert.throws(() => providerReply(config("openai"), { status: "incomplete", incomplete_details: { reason }, output: [
      { type: "function_call", call_id: "call", name: "shell", arguments: "{" },
    ] }, newTransportContext()), function unknown(error: unknown) {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof ModelOutputError, false);
      return true;
    });
  }
});


test("HTTP rejection retains only status and validated Retry-After, with one request", async function httpRejection() {
  let header = "120";
  let status = 429;
  let requests = 0;
  const server = createServer(function rejected(req, res) {
    req.resume();
    requests++;
    res.writeHead(status, { "retry-after": header });
    res.end(JSON.stringify({ error: { message: config("kimi").apiKey, code: "untrusted-provider-body" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const provider = { ...config("kimi"), baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1` };
  try {
    for (const [value, expected] of [["120", 120], ["Thu, 01 Jan 1970 00:00:00 GMT", 0], ["tomorrow", null], ["-1", null], ["1.5", null], ["9007199254740992", null], ["Wed, 31 Feb 2027 00:00:00 GMT", null]] as const) {
      header = value;
      const before = requests;
      await assert.rejects(requestAgent(provider, request, newTransportContext(), new AbortController().signal), function safe(error: unknown) {
        assert.ok(error instanceof ModelHttpError);
        assert.equal(error.status, 429);
        assert.equal(error.retryAfterSeconds, expected);
        assert.equal(error.message, "The model provider returned 429.");
        assert.doesNotMatch(JSON.stringify(error), /test-secret|untrusted-provider-body/);
        return true;
      });
      assert.equal(requests, before + 1);
    }
    status = 503;
    await assert.rejects(requestAgent(provider, request, newTransportContext(), new AbortController().signal), { status: 503 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
