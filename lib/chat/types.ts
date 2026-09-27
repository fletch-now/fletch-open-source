import type { BuildAttachment } from "@/lib/build/types";

// Client-side chat model. Mirrors the 10-event SSE contract the build stream emits.

export type MessageRole = "user" | "assistant" | "system";
export type MessagePhase = "planning" | "answering" | "done";

export interface ToolCall {
  id?: string;
  output?: string;
  outputTruncated?: boolean;
  outputChars?: number;
  tool: string;
  input: string;
  summary?: string;
  // When this tab saw the step start, for the live log's timestamps.
  at?: number;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: BuildAttachment[];
  interimText?: string;
  toolCalls: ToolCall[];
  phase: MessagePhase;
  // Set instead of `content` when the run fails, so failures render as a compact
  // notice rather than as body prose.
  error?: string;
  canRetry?: boolean;
  buildId?: string;
}
