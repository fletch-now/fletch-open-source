import type { ModelOutputFailure } from "./provider-transport";

export interface CliEvent {
  kind: "init" | "text" | "tool" | "tool_result" | "result" | "error" | "boundary";
  sessionId?: string;
  text?: string;
  tool?: string;
  toolPath?: string;
  toolCallId?: string;
  output?: string;
  outputTruncated?: boolean;
  outputChars?: number;
  costUsd?: number;
  usageMissing?: boolean;
  modelFailure?: ModelOutputFailure;
  inputTokens?: number;
  outputTokens?: number;
}

const OUTPUT_EXCERPT_CHARS = 160;
export const TOOL_OUTPUT_CHARS = 32_768;

// The line of a tool's output worth showing live: a compiler or test verdict
// when there is one, otherwise the first line. ANSI colour and paths inside the
// sandbox are stripped; the console shows what happened, not where.
export function outputExcerpt(raw: string): string {
  const lines = raw
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\/work\//g, "")
    .split("\n")
    .map(function trim(line) {
      return line.trim();
    })
    .filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  const verdict = [...lines].reverse().find(function isVerdict(line) {
    return /passed|failed|error|warning|compiler run|wrote|created|deleted|success/i.test(line);
  });
  const chosen = verdict ?? lines[0];
  return chosen.length > OUTPUT_EXCERPT_CHARS ? `${chosen.slice(0, OUTPUT_EXCERPT_CHARS - 1)}…` : chosen;
}

function toolContentText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(function textOf(part) {
        return typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string" ? String((part as Record<string, unknown>).text) : "";
      })
      .join("\n");
  }
  return "";
}

// kimi-code: {"role":"assistant"|"tool"|"meta", ...}
export function parseKimiLine(message: Record<string, unknown>, scope: string): CliEvent[] {
  if (message.role === "tool") {
    const output = toolContentText(message.content).replace(/\u001b\[[0-9;]*m/g, "");
    return [{
      kind: "tool_result",
      toolCallId: scopedCallId(message.tool_call_id, scope),
      text: outputExcerpt(output),
      output: output.slice(0, TOOL_OUTPUT_CHARS),
      outputTruncated: output.length > TOOL_OUTPUT_CHARS,
      outputChars: output.length,
    }];
  }
  if (message.role === "meta") {
    if (message.type === "session.resume_hint" && message.session_id) {
      return [{ kind: "init", sessionId: String(message.session_id) }];
    }
    return [];
  }

  if (message.role === "assistant") {
    const events: CliEvent[] = [];
    const calls = (message.tool_calls ?? []) as Array<Record<string, unknown>>;
    for (const call of calls) {
      const fn = (call.function ?? {}) as Record<string, unknown>;
      let path = "";
      try {
        const parsed = JSON.parse(String(fn.arguments ?? "{}")) as Record<string, unknown>;
        path = String(parsed.path ?? parsed.file_path ?? parsed.command ?? "");
      } catch {
        path = "";
      }
      events.push({ kind: "tool", tool: String(fn.name ?? "tool"), toolPath: path, toolCallId: scopedCallId(call.id, scope) });
    }
    if (typeof message.content === "string" && message.content.trim()) {
      events.push({ kind: "text", text: message.content });
    }
    return events;
  }

  return [];
}

function scopedCallId(value: unknown, scope: string): string | undefined {
  return typeof value === "string" && value ? `${scope}:${value}` : undefined;
}
