import { buildSignal, checkBuildCancellation } from "@/lib/build/cancellation";
import { providerIntegrationEnabled } from "@/lib/agent/provider-settings";
import "server-only";
import type { ProviderConfig } from "@/lib/agent/provider";
import { credentialStillActive } from "@/lib/agent/user-keys";
import { newTransportContext, requestAgent } from "@/lib/agent/provider-transport";
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface Usage { inputTokens: number; outputTokens: number }
export interface ChatResult { text: string; usage: Usage | null; finishReason: string }
interface StreamOptions { signal?: AbortSignal; maxTokens?: number; onDelta?: (delta: string) => void }
export async function streamChat(config: ProviderConfig, messages: ChatMessage[], options: StreamOptions = {}): Promise<ChatResult> {
  if (!await providerIntegrationEnabled(config.id)) throw new Error("The model provider integration is paused.");
  if (!await credentialStillActive(config)) throw new Error("The model key was revoked. Reconnect it in Settings.");
  checkBuildCancellation();
  const requestedSignal = buildSignal(options.signal);
  const signal = requestedSignal ? AbortSignal.any([requestedSignal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000);
  const reply = await requestAgent(config, { model: config.model, messages, max_tokens: options.maxTokens ?? 8000 }, newTransportContext(), signal);
  const text = reply.message.content ?? "";
  options.onDelta?.(text);
  return { text, usage: reply.usage, finishReason: reply.finishReason };
}
