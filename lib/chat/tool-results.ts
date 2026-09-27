import type { ToolCall } from "@/lib/chat/types";

export interface ToolResult {
  id?: string;
  summary: string;
  output?: string;
  outputTruncated?: boolean;
  outputChars?: number;
}

// Historical parallel calls lack identity. Keep their output visible without
// attributing it to whichever unrelated call happened to be recorded last.
export function applyToolResult(calls: ToolCall[], result: ToolResult): void {
  let call: ToolCall | undefined;
  if (result.id) {
    call = calls.find(function matches(candidate) { return candidate.id === result.id; });
  } else if (result.output === undefined) {
    call = calls[calls.length - 1];
  }
  if (!call) {
    call = { id: result.id, tool: "Tool output", input: "Call identity was not recorded." };
    if (result.id) call.input = "The matching tool call was not recorded.";
    calls.push(call);
  }
  call.summary = result.summary;
  call.output = result.output;
  call.outputTruncated = result.outputTruncated;
  call.outputChars = result.outputChars;
}
