import assert from "node:assert/strict";
import { test } from "node:test";
import { agentContextBudget, AGENT_CONTEXT_RESERVE_TOKENS, AGENT_OUTPUT_TOKENS, COMPACTION_GUIDANCE, COMPACTION_OUTPUT_TOKENS, MAX_SAVED_SUMMARY_CHARS, compactionRequest, isCompactionRequest } from "./context-policy";
import type { AgentRequest } from "./provider-transport";
import { CODE_SIMPLIFIER_STANDARD } from "./code-simplifier";

export const SUMMARY_REQUEST = "You are about to run out of context. Write a first-person handoff note to\nyourself\n--- This message is a direct task, not part of the above conversation ---\nRespond with text only. Do not call any tools";

test("native summarization stays tool-free and retains its exact conversation", function policy() {
  const input: AgentRequest = { model: "chosen", messages: [{ role: "user", content: "Use the forest theme" }, { role: "assistant", content: "Tests ran; stylesheet remains" }, { role: "user", content: SUMMARY_REQUEST }] };
  assert.equal(isCompactionRequest(input), true);
  const compacted = compactionRequest(input);
  assert.deepEqual(compacted.messages.slice(0, -1), input.messages.slice(0, -1));
  assert.match(compacted.messages.at(-1)!.content!, /quality-first/);
  assert.match(compacted.messages.at(-1)!.content!, /active build state/);
  assert.equal(compacted.max_tokens, COMPACTION_OUTPUT_TOKENS);
  assert.equal(compacted.tools, undefined);
  assert.equal(input.messages.at(-1)!.content, SUMMARY_REQUEST);
  const native = { ...input, tools: [{ type: "function" as const, function: { name: "Read", parameters: {} } }] };
  assert.equal(isCompactionRequest(native), true);
  assert.equal(compactionRequest(native).tools, undefined);
  assert.equal(isCompactionRequest({ ...input, messages: [{ role: "user", content: `Please explain ${SUMMARY_REQUEST}` }] }), false);
});

test("working windows reserve room for output, with a smaller custom-model default", function budgets() {
  for (const model of ["kimi-k3", "gpt-5.2", "claude-sonnet-4-5"]) assert.equal(agentContextBudget(model), 131_072);
  assert.equal(agentContextBudget("custom-unreviewed"), 65_536);
  assert.ok(AGENT_OUTPUT_TOKENS <= agentContextBudget("custom-unreviewed") / 2);
  assert.equal(COMPACTION_OUTPUT_TOKENS, AGENT_OUTPUT_TOKENS);
  assert.equal(MAX_SAVED_SUMMARY_CHARS, 48_000);
  assert.match(COMPACTION_GUIDANCE, /verified facts/);
  const proxyBytes = Buffer.byteLength(CODE_SIMPLIFIER_STANDARD + COMPACTION_GUIDANCE, "utf8");
  assert.ok(AGENT_CONTEXT_RESERVE_TOKENS >= Math.max(AGENT_OUTPUT_TOKENS, COMPACTION_OUTPUT_TOKENS) + proxyBytes);
  assert.ok(AGENT_CONTEXT_RESERVE_TOKENS < 32_768, "Keep more active conversation than the earlier reserve");
  for (const model of ["kimi-k3", "custom-unreviewed"]) {
    const window = agentContextBudget(model);
    const trigger = Math.min(window * 0.85, window - AGENT_CONTEXT_RESERVE_TOKENS);
    assert.ok(window - trigger >= COMPACTION_OUTPUT_TOKENS + proxyBytes);
    assert.ok(trigger > window / 2, "Neither working window should compact before its halfway point");
  }
});
