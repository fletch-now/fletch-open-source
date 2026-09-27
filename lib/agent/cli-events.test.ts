import assert from "node:assert/strict";
import { test } from "node:test";
import { parseKimiLine, TOOL_OUTPUT_CHARS } from "./cli-events";
import { applyToolResult } from "../chat/tool-results";
import type { ToolCall } from "../chat/types";

test("parallel tool results retain their own multiline output and survive persisted replay", function () {
  const starts = parseKimiLine({ role: "assistant", tool_calls: [
    { id: "a", function: { name: "Read", arguments: '{"path":"first.ts"}' } },
    { id: "b", function: { name: "Read", arguments: '{"path":"second.ts"}' } },
  ] }, "turn-1");
  const calls: ToolCall[] = starts.map(function call(event) {
    return { id: event.toolCallId, tool: event.tool!, input: event.toolPath! };
  });
  const second = "1\tinterface ImportMetaEnv {\n2\t  readonly CHAIN_ID: number;\n3\t}";
  const first = "compiler run failed\nOriginal compiler diagnosis\nline 3";
  for (const [id, output] of [["b", second], ["a", first]]) {
    const [event] = parseKimiLine({ role: "tool", tool_call_id: id, content: [{ type: "text", text: output }] }, "turn-1");
    const persisted = JSON.parse(JSON.stringify(event));
    applyToolResult(calls, { id: persisted.toolCallId, summary: persisted.text, output: persisted.output });
  }
  assert.equal(calls.length, 2);
  assert.equal(calls[0].output, first);
  assert.equal(calls[1].output, second);
  assert.equal(calls[1].input, "second.ts");
});

test("empty tool results complete the matching call; repair turns cannot collide", function () {
  const [result] = parseKimiLine({ role: "tool", tool_call_id: "same", content: "" }, "repair");
  assert.equal(result.output, "");
  assert.equal(result.outputChars, 0);
  assert.equal(result.outputTruncated, false);
  const calls: ToolCall[] = [{ id: "initial:same", tool: "Read", input: "first" }, { id: "repair:same", tool: "Read", input: "second" }];
  applyToolResult(calls, { id: result.toolCallId, summary: result.text!, output: result.output });
  assert.equal(calls[0].output, undefined);
  assert.equal(calls[1].output, "");
});

test("long output has a stated bound and original size, while short output keeps its lines", function () {
  const raw = "x".repeat(TOOL_OUTPUT_CHARS + 900);
  const [event] = parseKimiLine({ role: "tool", content: raw }, "one");
  assert.equal(event.output?.length, TOOL_OUTPUT_CHARS);
  assert.equal(event.outputChars, raw.length);
  assert.equal(event.outputTruncated, true);
  const [colored] = parseKimiLine({ role: "tool", content: "\u001b[31merror\u001b[0m\n  /work/file.ts:3" }, "one");
  assert.equal(colored.output, "error\n  /work/file.ts:3");
});

test("unidentified historical output is visible without overwriting another call", function () {
  const calls: ToolCall[] = [{ tool: "Read", input: "first.ts" }, { tool: "Read", input: "second.ts" }];
  applyToolResult(calls, { summary: "old excerpt", output: "old excerpt" });
  assert.equal(calls[0].output, undefined);
  assert.equal(calls[1].output, undefined);
  assert.equal(calls[2].output, "old excerpt");
  assert.equal(calls[2].input, "Call identity was not recorded.");
});
