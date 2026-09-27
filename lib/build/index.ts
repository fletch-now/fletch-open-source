import { StubBuilder } from "@/lib/build/stub-builder";
import { UnavailableBuilder } from "@/lib/build/unavailable-builder";
import { KimiBuilder, type BuildCost } from "@/lib/build/kimi-builder";
import { CliBuilder } from "@/lib/build/cli-builder";
import { platformProvider, type ProviderConfig } from "@/lib/agent/provider";
import type { Builder } from "@/lib/build/types";
import type { NeedsVerdict } from "@/lib/agent/needs-rules";
import { workspaceRoot } from "@/lib/build/workspace";

export interface BuilderOptions {
  provider?: ProviderConfig;
  onCost?: (cost: BuildCost) => void;
  onSession?: (sessionId: string) => void;
  onModel?: (model: string) => void;
  onNeeds?: (verdict: NeedsVerdict, overridden: boolean) => void;
  onStop?: (stop: () => void) => void;
  onBroadcast?: (txHash: string) => Promise<void>;
  resumeSessionId?: string;
}

// Three runtimes, in descending order of capability:
//   agent CLI  — a real coding agent with tools; can compile, read errors, retry.
//   single call — one model call that emits a file set; no tool loop.
//   stub       — no key configured; keeps the product demoable offline.
// FORGE_AGENT=cli opts into the CLI once its binary is installed on the host.
export function getBuilder(options: BuilderOptions = {}): Builder {
  const provider = options.provider ?? platformProvider();
  if (!provider) {
    // The stub fabricates a deployment. That is fine as an offline demo and
    // unacceptable in production, where a missing key must surface as a failure
    // (which refunds the credit) rather than as a convincing fake.
    if (process.env.NODE_ENV === "production") {
      return new UnavailableBuilder();
    }
    return new StubBuilder();
  }

  if (process.env.FORGE_AGENT === "cli") {
    return new CliBuilder({
      provider,
      workspaceRoot: workspaceRoot(),
      onCost: options.onCost,
      onSession: options.onSession,
      onModel: options.onModel,
      onNeeds: options.onNeeds,
      onStop: options.onStop,
      onBroadcast: options.onBroadcast,
      resumeSessionId: options.resumeSessionId,
    });
  }

  return new KimiBuilder(provider, options.onCost);
}
