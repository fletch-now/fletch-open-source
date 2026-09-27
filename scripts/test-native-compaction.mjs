import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { agentContextBudget, AGENT_CONTEXT_RESERVE_TOKENS, AGENT_OUTPUT_TOKENS, COMPACTION_OUTPUT_TOKENS, compactionRequest, isCompactionRequest } from "../lib/agent/context-policy.ts";
import { CODE_SIMPLIFIER_STANDARD, withCodeSimplifier } from "../lib/agent/code-simplifier.ts";

// Bundle this fixture with esbuild before placing it in the isolated sandbox.
const model = process.env.FLETCH_NATIVE_MODEL ?? "kimi-k3";
const window = agentContextBudget(model);
const trigger = Math.min(window * 0.85, window - AGENT_CONTEXT_RESERVE_TOKENS);
const runtime = JSON.parse(await readFile("/usr/local/lib/node_modules/@moonshot-ai/kimi-code/package.json", "utf8"));
assert.equal(runtime.version, "0.39.1");
await mkdir("/work/.agent-home/.kimi-code", { recursive: true });
const observed = [];
let regular = 0;
let summaryCount = 0;
const summary =
  "I keep the original forest theme and the ten-by-ten hex board. The marker was written once and its tool completed. Pending: write the stylesheet marker, then finish. This note does not verify compilation or deployment.";
const server = createServer(async function respond(req, res) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = JSON.parse(Buffer.concat(chunks));
  const compacting = isCompactionRequest(body);
  const forwarded = withCodeSimplifier(compacting ? compactionRequest(body) : body);
  const injectedMessageBytes = Buffer.byteLength(JSON.stringify(forwarded.messages)) - Buffer.byteLength(JSON.stringify(body.messages));
  assert.ok(AGENT_CONTEXT_RESERVE_TOKENS >= Math.max(AGENT_OUTPUT_TOKENS, COMPACTION_OUTPUT_TOKENS) + injectedMessageBytes);
  assert.equal(forwarded.messages[0].content, CODE_SIMPLIFIER_STANDARD);
  if (compacting) {
    assert.equal(forwarded.tools, undefined);
    assert.equal(forwarded.max_tokens, COMPACTION_OUTPUT_TOKENS);
  }
  observed.push({
    compacting,
    tools: body.tools?.length ?? 0,
    nativeToolSchemaBytes: Buffer.byteLength(JSON.stringify(body.tools ?? [])),
    forwardedToolSchemaBytes: Buffer.byteLength(JSON.stringify(forwarded.tools ?? [])),
    injectedPolicyBytes: Buffer.byteLength(CODE_SIMPLIFIER_STANDARD),
    injectedMessageBytes,
    forwardedMessageCount: forwarded.messages.length,
    hasSummary: JSON.stringify(body.messages).includes(summary),
    maxTokens: body.max_tokens,
    hasPendingTask: JSON.stringify(body.messages).includes(
      "VERIFY-DESIGN-AFTER-STYLESHEET",
    ),
    maxCompletionTokens: body.max_completion_tokens,
    messageCount: body.messages?.length,
  });
  let message, finish_reason, input;
  if (compacting) {
    summaryCount++;
    message = { role: "assistant", content: summary };
    finish_reason = "stop";
    input = Math.ceil(trigger) + 256;
  } else {
    regular++;
    input = 1500;
    if (regular === 1) input = Math.floor(trigger) - 1024;
    if (regular === 2) input = Math.ceil(trigger) + 64;
    if (regular <= 3) {
      const command =
        regular <= 2
          ? "printf x >> /work/marker.txt"
          : "printf y >> /work/stylesheet.txt";
      message = {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "write-" + regular,
            type: "function",
            function: { name: "Bash", arguments: JSON.stringify({ command }) },
          },
        ],
      };
      if (regular === 1) message.tool_calls = [];
      finish_reason = "tool_calls";
    } else {
      message = {
        role: "assistant",
        content: "The retained tasks are finished.",
      };
      finish_reason = "stop";
    }
  }
  if (!compacting && regular === 1)
    message.tool_calls.push({
      id: "todos",
      type: "function",
      function: {
        name: "TodoList",
        arguments: JSON.stringify({
          todos: [
            { title: "VERIFY-DESIGN-AFTER-STYLESHEET", status: "pending" },
          ],
        }),
      },
    });
  const base = {
    id: "fixture-" + observed.length,
    model: "fixture",
    usage: {
      prompt_tokens: input,
      completion_tokens: 30,
      total_tokens: input + 30,
    },
  };
  res.writeHead(200, {
    "content-type": body.stream ? "text/event-stream" : "application/json",
  });
  if (body.stream)
    res.end(
      "data: " +
        JSON.stringify({
          ...base,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: message, finish_reason }],
        }) +
        "\n\ndata: [DONE]\n\n",
    );
  else
    res.end(
      JSON.stringify({
        ...base,
        object: "chat.completion",
        choices: [{ index: 0, message, finish_reason }],
      }),
    );
});
await new Promise((r) => server.listen(45112, "127.0.0.1", r));
await writeFile(
  "/work/.agent-home/.kimi-code/config.toml",
  `default_model = "forge/fixture"
[providers.forge]
base_url = "http://127.0.0.1:45112/v1"
type = "kimi"
api_key = "fixture-only"
[models."forge/fixture"]
provider = "forge"
model = "fixture"
max_context_size = ${window}
max_output_size = ${AGENT_OUTPUT_TOKENS}
capabilities = ["tool_use"]
[loop_control]
reserved_context_size = ${AGENT_CONTEXT_RESERVE_TOKENS}
max_steps_per_turn = 10
`,
);
async function run(session) {
  const args = [
    "--output-format",
    "stream-json",
    "-p",
    session
      ? "Continue using the saved summary. Do not repeat the marker writes."
      : "Keep the forest theme and ten-by-ten board. Write a marker once, then a stylesheet marker.",
  ];
  if (session) args.push("-S", session);
  const child = spawn("kimi", args, {
    cwd: "/work",
    env: { PATH: process.env.PATH, HOME: "/work/.agent-home" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (c) => (stdout += c));
  child.stderr.on("data", (c) => (stderr += c));
  const timer = setTimeout(() => child.kill("SIGKILL"), 40000);
  const code = await new Promise((r) => child.on("close", r));
  clearTimeout(timer);
  return { code, stdout, stderr };
}
try {
  const first = await run();
  assert.equal(first.code, 0, first.stderr);
  const entry = JSON.parse(
    (await readFile("/work/.agent-home/.kimi-code/session_index.jsonl", "utf8"))
      .trim()
      .split("\n")
      .at(-1),
  );
  const wire = (
    await readFile(entry.sessionDir + "/agents/main/wire.jsonl", "utf8")
  )
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const compacted = wire.filter((e) => e.type === "context.apply_compaction");
  const second = await run(entry.sessionId);
  assert.equal(second.code, 0, second.stderr);
  assert.ok(summaryCount > 0);
  assert.deepEqual(observed.slice(0, 3).map((entry) => entry.compacting), [false, false, true], "The native threshold retains context below the boundary and compacts above it");
  assert.ok(compacted.length > 0);
  assert.ok(observed.at(-1).hasSummary);
  assert.ok(observed.at(-1).hasPendingTask);
  assert.equal(await readFile("/work/marker.txt", "utf8"), "x");
  assert.equal(await readFile("/work/stylesheet.txt", "utf8"), "y");
  console.log(
    JSON.stringify({
      model,
      runtimeVersion: runtime.version,
      window,
      reserve: AGENT_CONTEXT_RESERVE_TOKENS,
      trigger,
      outputLimit: AGENT_OUTPUT_TOKENS,
      summaryOutputLimit: COMPACTION_OUTPUT_TOKENS,
      firstCode: first.code,
      secondCode: second.code,
      summaryCount,
      observed,
      compactions: compacted.map((e) => ({
        compactedCount: e.compactedCount,
        tokensBefore: e.tokensBefore,
        tokensAfter: e.tokensAfter,
        hasSummary: e.summary.includes(summary),
      })),
      marker: "x",
      stylesheet: "y",
      firstMeta: first.stdout
        .split("\n")
        .filter((l) => l.includes('"role":"meta"')),
    }),
  );
} catch (e) {
  console.error(e);
  console.error(JSON.stringify(observed));
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  server.close();
}
