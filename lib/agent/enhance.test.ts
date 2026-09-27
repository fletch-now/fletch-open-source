import assert from "node:assert/strict";
import { test } from "node:test";
import { enhancementResult } from "./enhance";
import { MAX_PROMPT_CHARS } from "@/lib/build/prompt-limits";

test("empty and token-limited provider replies are service failures, not invalid user ideas", function incomplete() {
  for (const [text, reason] of [["", "stop"], ["Partial brief", "length"], ["NEEDS_MORE_DETAIL", "length"]]) {
    const result = enhancementResult(text, reason);
    assert.equal(result.status, 502);
    assert.ok("error" in result.body);
    assert.equal("prompt" in result.body, false);
  }
});

test("only an exact clarification marker produces an actionable 422", function clarification() {
  assert.equal(enhancementResult(" NEEDS_MORE_DETAIL ", "stop").status, 422);
  const literal = "Display the text NOT_A_BUILD in the example code panel.";
  assert.deepEqual(enhancementResult(literal, "stop"), { status: 200, body: { prompt: literal } });
});

test("long enhanced requirements are retained in full and overflow is never silently clipped", function length() {
  const prompt = "Keep all requirements. ".repeat(200) + "Preserve the final accessible keyboard control.";
  assert.deepEqual(enhancementResult(prompt, "stop"), { status: 200, body: { prompt } });
  assert.equal(enhancementResult("x".repeat(MAX_PROMPT_CHARS), "stop").status, 200);
  const oversized = enhancementResult("x".repeat(MAX_PROMPT_CHARS + 1), "stop");
  assert.equal(oversized.status, 502);
  assert.equal("prompt" in oversized.body, false);
});
