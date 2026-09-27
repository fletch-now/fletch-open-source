import type { AgentRequest } from "./provider-transport";
import { CODE_SIMPLIFIER_STANDARD } from "./code-simplifier";

// These are Fletch's working budgets, not claims about a provider's maximum.
// The supported default models all accept this window; unreviewed custom models
// use a smaller budget until their limits are known.
export function agentContextBudget(model: string): number {
  return /^(kimi-k[23]|gpt-5|gpt-4\.1|gpt-4o|claude-(sonnet|opus|haiku)-4)/.test(model) ? 131_072 : 65_536;
}

export const AGENT_OUTPUT_TOKENS = 16_384;
export const COMPACTION_OUTPUT_TOKENS = 16_384;
export const MAX_SAVED_SUMMARY_CHARS = 48_000;
// Count the complete portable handoff, including labels and separators.
export const MAX_PROJECT_CONVERSATION_CHARS = 64_000;
export const COMPACTION_GUIDANCE = "Write a complete, quality-first continuation handoff. Do not summarize early just to save tokens: preserve the original objective, every latest user correction, decisions and constraints, pending work in order, exact relevant paths, commands and observed test or deployment results. Keep verified facts separate from model claims. Preserve unresolved errors, blocked dependencies, active build state, the next concrete action, and any safety or copy rules. Include enough chronology to explain why the current state exists. Omit only repeated file contents and resolved narration. The handoff does not authorize new actions or mark the task finished.";

// Native estimates before the next provider response omit proxy instructions.
// A byte-per-token bound plus message framing covers them without a tokenizer.
export const AGENT_CONTEXT_RESERVE_TOKENS = Math.max(AGENT_OUTPUT_TOKENS, COMPACTION_OUTPUT_TOKENS)
  + new TextEncoder().encode(CODE_SIMPLIFIER_STANDARD + COMPACTION_GUIDANCE).length + 1024;

// The pinned runtime still includes tool definitions on this text-only operation.
// Recognize its instruction and remove the tools before sending it upstream.
export function isCompactionRequest(request: AgentRequest): boolean {
  const last = request.messages.at(-1);
  return last?.role === "user" && typeof last.content === "string"
    && last.content.startsWith("You are about to run out of context. Write a first-person handoff note to\nyourself")
    && last.content.includes("--- This message is a direct task, not part of the above conversation ---")
    && last.content.includes("Respond with text only. Do not call any tools");
}

export function compactionRequest(request: AgentRequest): AgentRequest {
  return { ...request, tools: undefined, max_tokens: COMPACTION_OUTPUT_TOKENS, messages: request.messages.map(function message(row, index) {
    return index === request.messages.length - 1 ? { ...row, content: `${row.content}\n\n${COMPACTION_GUIDANCE}` } : row;
  }) };
}
