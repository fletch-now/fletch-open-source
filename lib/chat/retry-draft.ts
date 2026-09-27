import type { ChatMessage } from "./types";
import type { BuildAttachment } from "@/lib/build/types";

interface RetryDraft {
  prompt: string;
  attachments: BuildAttachment[];
}

export function retryDraft(messages: ChatMessage[], assistantId: string): RetryDraft | null {
  const index = messages.findIndex((message) => message.id === assistantId && message.role === "assistant");
  for (let previous = index - 1; previous >= 0; previous -= 1) {
    const message = messages[previous];
    if (message.role === "user") {
      return { prompt: message.content, attachments: (message.attachments ?? []).map((file) => ({ ...file })) };
    }
  }
  return null;
}
