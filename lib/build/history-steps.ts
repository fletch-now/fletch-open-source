import type { BuildEvent } from "@/lib/build/types";
import type { ToolCall } from "@/lib/chat/types";
import { applyToolResult } from "@/lib/chat/tool-results";

// Match the step-producing branches of the build SSE route. Artifact and
// analysis frames update other panels, so counting them as saved steps would
// prevent a reconnecting stream from catching up with the saved conversation.
export function recordedBuildSteps(events: readonly BuildEvent[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const event of events) {
    if (event.phase === "done" || event.phase === "error") continue;
    const at = event.at ? Date.parse(event.at) : undefined;
    if (event.phase === "note") {
      calls.push({ tool: "note", input: event.text, at, summary: "said" });
      continue;
    }
    if (event.artifact) continue;
    if (event.toolOutput !== undefined) {
      applyToolResult(calls, {
        id: event.toolCallId,
        summary: event.text,
        output: event.toolOutput,
        outputTruncated: event.toolOutputTruncated,
        outputChars: event.toolOutputChars,
      });
      continue;
    }
    if (event.needs) {
      calls.push({ tool: event.phase, input: event.text, at, summary: "done" });
    } else if (event.compile) {
      calls.push({ tool: "compiling", input: event.text, at, summary: event.compile.ok ? "compiled" : "failed" });
    } else if (event.analysis) {
      continue;
    } else if (event.tests) {
      calls.push({ tool: "testing", input: event.text, at, summary: `${event.tests.passed}/${event.tests.total}` });
    } else {
      calls.push({ id: event.toolCallId, tool: event.phase, input: event.text, at, summary: event.toolCallId ? undefined : "done" });
    }
  }
  return calls;
}
