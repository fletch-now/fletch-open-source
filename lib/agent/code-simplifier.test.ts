import assert from "node:assert/strict";
import { test } from "node:test";
import { CODE_SIMPLIFIER_STANDARD, withCodeSimplifier } from "./code-simplifier";
import policy from "./code-simplifier-policy.json";
import type { ProviderConfig } from "./provider";
import { newTransportContext, providerRequest, type AgentRequest } from "./provider-transport";

for (const id of ["kimi", "openai", "anthropic"] as const) {
  test(`${id} receives the complete coding standard while preserving the chosen model and tool exchange`, function policyDelivery() {
    const provider: ProviderConfig = {
      id, model: "chosen-model", apiKey: "fixture-only", baseUrl: "https://unused.invalid",
      bringYourOwnKey: true, inputPerMTok: 0, outputPerMTok: 0,
    };
    const request: AgentRequest = {
      model: provider.model, max_tokens: 1234,
      messages: [
        { role: "system", content: "Existing platform constraints" },
        { role: "user", content: "Continue with the saved medieval theme" },
        { role: "assistant", tool_calls: [{ id: "read-1", type: "function", function: { name: "Read", arguments: '{"path":"src/App.tsx"}' } }] },
        { role: "tool", tool_call_id: "read-1", content: "Saved component source" },
      ],
      tools: [{ type: "function", function: { name: "Read", parameters: { type: "object" } } }],
    };
    const before = structuredClone(request);
    const context = newTransportContext();
    const original = providerRequest(provider, request, context).body;
    const body = providerRequest(provider, withCodeSimplifier(request), context).body;
    assert.deepEqual(request, before, "Saved conversation is not mutated");
    assert.equal(body.model, provider.model);
    assert.deepEqual(body.tools, original.tools);
    assert.ok(CODE_SIMPLIFIER_STANDARD.includes(policy.instructions), "Full reviewed upstream body is supplied");

    if (id === "anthropic") {
      assert.equal(body.system, `${CODE_SIMPLIFIER_STANDARD}\n\n${original.system}`);
      assert.deepEqual(body.messages, original.messages);
      assert.equal(body.max_tokens, original.max_tokens);
    } else {
      const field = id === "openai" ? "input" : "messages";
      const messages = body[field] as unknown[];
      assert.deepEqual(messages[0], { role: "system", content: CODE_SIMPLIFIER_STANDARD });
      assert.deepEqual(messages.slice(1), original[field]);
      assert.equal(body.max_tokens ?? body.max_output_tokens, 1234);
    }
  });
}
