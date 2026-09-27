import "server-only";
import type { BuildImageAttachment } from "@/lib/build/types";
import type { ModelCapabilities } from "@/lib/agent/selection";

import { defaultModel, type ProviderId } from "@/lib/agent/selection";
export type { ProviderId } from "@/lib/agent/selection";

export interface ProviderConfig {
  id: ProviderId;
  baseUrl: string;
  apiKey: string;
  model: string;
  // USD per million tokens, used to price a build from its reported usage.
  inputPerMTok: number;
  outputPerMTok: number;
  // True when the user supplied the key, so we do not charge credits for tokens.
  bringYourOwnKey: boolean;
  gatewayId?: string;
  credentialId?: string;
  credentialVersion?: number;
  ownerId?: string;
  buildId?: string;
  capabilities?: ModelCapabilities;
  referenceImages?: BuildImageAttachment[];
}

const KIMI_BASE = "https://api.moonshot.ai/v1";
const OPENAI_BASE = "https://api.openai.com/v1";

const KIMI_MODELS: Record<string, { input: number; output: number }> = {
  "kimi-k3": { input: 3, output: 15 },
  "kimi-k2.7-code": { input: 0.95, output: 4 },
};

export function platformProvider(): ProviderConfig | null {
  const apiKey = process.env.MOONSHOT_API_KEY ?? "";
  if (!apiKey) {
    return null;
  }
  const model = process.env.MOONSHOT_MODEL ?? "kimi-k3";
  const price = KIMI_MODELS[model] ?? KIMI_MODELS["kimi-k3"];
  return {
    id: "kimi",
    baseUrl: KIMI_BASE,
    apiKey,
    model,
    inputPerMTok: price.input,
    outputPerMTok: price.output,
    bringYourOwnKey: false,
  };
}

// A user's own key. Tokens are billed by their provider, so no credit is spent.
export function userProvider(id: ProviderId, apiKey: string, model?: string): ProviderConfig {
  const urls: Record<ProviderId, string> = {
    openai: OPENAI_BASE, kimi: KIMI_BASE, anthropic: "https://api.anthropic.com/v1",
  };
  return { id, baseUrl: urls[id], apiKey, model: model ?? defaultModel(id),
    inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true };
}

export function costUsd(config: ProviderConfig, inputTokens: number, outputTokens: number): number {
  const input = (inputTokens / 1_000_000) * config.inputPerMTok;
  const output = (outputTokens / 1_000_000) * config.outputPerMTok;
  return Number((input + output).toFixed(6));
}
