// Safe to import in the composer: this contract contains no credentials.
export type ProviderId = "kimi" | "openai" | "anthropic";
export interface ModelCapabilities { text: boolean; tools: boolean; images: boolean }
export type BuildSelection = { billingMode: "platform" } | {
  billingMode: "own_key";
  custodyMode?: "hosted" | "gateway";
  credentialId: string;
  credentialVersion: number;
  provider: ProviderId;
  model: string;
};
export const TEXT_CAPABILITIES: ModelCapabilities = { text: true, tools: true, images: false };
// Explicit documented vision models. Unknown/custom IDs stay text-only until
// their native protocol support is reviewed. Gateway v1 accepts text only.
export function modelCapabilities(provider: ProviderId, model: string, custodyMode = "hosted"): ModelCapabilities {
  if (custodyMode === "gateway") return { ...TEXT_CAPABILITIES };
  const models: Record<ProviderId, string[]> = {
    kimi: ["kimi-k3", "kimi-k2.5", "kimi-k2.6"],
    openai: ["gpt-5.2", "gpt-5.2-2025-12-11", "gpt-4.1", "gpt-4o"],
    anthropic: ["claude-sonnet-4-5", "claude-sonnet-4-5-20250929"],
  };
  return { ...TEXT_CAPABILITIES, images: models[provider].includes(model) };
}
export function isProviderId(value: string): value is ProviderId {
  return value === "kimi" || value === "openai" || value === "anthropic";
}
export function defaultModel(provider: ProviderId): string {
  if (provider === "openai") return "gpt-5.2";
  if (provider === "anthropic") return "claude-sonnet-4-5";
  return "kimi-k3";
}
export function validModel(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$/.test(model);
}
export class BuildSelectionError extends Error {
  constructor(message = "Reconnect your selected model key and submit a new build.") {
    super(message);
    this.name = "BuildSelectionError";
  }
}
