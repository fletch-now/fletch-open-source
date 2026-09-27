import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCleanAgentWire } from "./cli-continuation";

function wire(options: { error?: string; omitResult?: boolean; afterEnd?: boolean; maxSteps?: number } = {}): string {
  const entries = [
    { type: "turn.prompt", turnId: 4 },
    { type: "context.append_loop_event", event: { type: "step.begin", turnId: "4" } },
    { type: "context.append_loop_event", event: { type: "tool.call", turnId: "4", uuid: "owned-call" } },
    ...options.omitResult ? [] : [{ type: "context.append_loop_event", event: { type: "tool.result", parentUuid: "owned-call" } }],
    { type: "context.append_loop_event", event: { type: "step.end", turnId: "4" } },
    { type: "turn.ended", agentId: "main", turnId: 4, reason: "failed", error: { code: options.error ?? "loop.max_steps_exceeded", retryable: false, details: { maxSteps: options.maxSteps ?? 2 } } },
    { type: "token_counting.turn_recorded" },
    ...options.afterEnd ? [{ type: "turn.prompt", turnId: 5 }] : [],
  ];
  return entries.map(entry => JSON.stringify(entry)).join("\n");
}

test("only exact clean max-step exits with complete tool receipts permit continuation", () => {
  assert.doesNotThrow(() => validateCleanAgentWire(wire(), 2));
  assert.throws(() => validateCleanAgentWire(wire({ error: "provider.api_error" }), 2), /supported clean/);
  assert.throws(() => validateCleanAgentWire(wire({ omitResult: true }), 2), /unfinished/);
  assert.throws(() => validateCleanAgentWire(wire({ afterEnd: true }), 2), /changed after/);
  assert.throws(() => validateCleanAgentWire(wire({ maxSteps: 3 }), 2), /supported clean/);
  assert.throws(() => validateCleanAgentWire("not JSON", 2));
});

test("prior completed turns do not hide an unmatched tool in the current turn", () => {
  assert.throws(() => validateCleanAgentWire(`${wire()}\n${wire({ omitResult: true })}`, 2), /unfinished/);
});
