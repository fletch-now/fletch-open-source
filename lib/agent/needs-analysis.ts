import { workerOperation } from "@/lib/build/durable/execution";
import { buildSignal, checkBuildCancellation } from "@/lib/build/cancellation";
import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { streamChat } from "@/lib/agent/chat";
import { costUsd, type ProviderConfig } from "@/lib/agent/provider";
import { NEEDS_SYSTEM_PROMPT, hasWalletCode, parseVerdict, type NeedsVerdict } from "@/lib/agent/needs-rules";
import { logEvent } from "@/lib/log";
import type { BuildCost } from "@/lib/build/kimi-builder";
import { needsAnalysisContext, type NeedsBrief } from "@/lib/agent/needs-context";

const ANALYSIS_TIMEOUT_MS = 180_000;
// A reasoning model spends tokens before it answers; a tight cap returned an
// empty answer on the box. The reply itself is under 60 tokens.
const ANALYSIS_MAX_TOKENS = 1_200;
const ANALYSIS_ATTEMPTS = 2;
const MAX_SOURCE_BYTES = 200_000;

export interface NeedsAnalysis {
  verdict: NeedsVerdict;
  cost: BuildCost | null;
}

export class NeedsAnalysisError extends Error {
  constructor(timedOut: boolean) {
    super(timedOut
      ? "Planning took longer than three minutes. Your brief and source files are saved. Restore the draft and submit it to retry planning."
      : "Planning could not get a complete response from the model. Your brief and source files are saved. Restore the draft and submit it to retry planning.");
    this.name = "NeedsAnalysisError";
  }
}

// A returned but unparseable answer can be retried. A failed request may still
// be billed by the provider, so it must reach cleanup before another build runs.
export async function analyseNeeds(provider: ProviderConfig, brief: NeedsBrief, hasContract: boolean, request: typeof streamChat = streamChat): Promise<NeedsAnalysis> {
  // Use the immutable submitted contents, not files the coding agent may have
  // changed. Refuse an oversized brief before the request/retry fallback.
  const prompt = needsAnalysisContext(brief);
  if (hasContract) {
    return { verdict: { contract: true, wallet: true, reason: "The app already has a contract on testnet.", source: "existing" }, cost: null };
  }
  const cost: BuildCost = { inputTokens: 0, outputTokens: 0, usd: 0, model: provider.model };
  for (let attempt = 1; attempt <= ANALYSIS_ATTEMPTS; attempt += 1) {
    checkBuildCancellation();
    const controller = new AbortController();
    const timer = setTimeout(function giveUp() {
      controller.abort();
    }, ANALYSIS_TIMEOUT_MS);
    try {
      const result = await workerOperation("needs", "model", async function analyse() {
        try {
          return await request(provider, [
            { role: "system", content: NEEDS_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ], { maxTokens: ANALYSIS_MAX_TOKENS, signal: buildSignal(controller.signal) });
        } catch (cause) {
          checkBuildCancellation();
          logEvent("build", { event: "needs-request-failed", attempt, message: cause instanceof Error ? cause.message : String(cause) });
          throw new NeedsAnalysisError(controller.signal.aborted);
        }
      });
      checkBuildCancellation();
      if (result.usage) {
        cost.inputTokens += result.usage.inputTokens;
        cost.outputTokens += result.usage.outputTokens;
        cost.usd += costUsd(provider, result.usage.inputTokens, result.usage.outputTokens);
      } else cost.usageComplete = false;
      const parsed = parseVerdict(result.text);
      if (parsed) {
        return { verdict: { ...parsed, source: "model" }, cost };
      }
      logEvent("build", { event: "needs-unparsed", attempt, text: result.text.slice(0, 200), outputTokens: result.usage?.outputTokens ?? null });
    } finally {
      clearTimeout(timer);
    }
  }
  return { verdict: fallback("The analysis gave no usable answer."), cost };
}

function fallback(reason: string): NeedsVerdict {
  return { contract: true, wallet: true, reason, source: "fallback" };
}

async function solidityFiles(workspace: string): Promise<string[]> {
  const entries = await readdir(join(workspace, "contracts")).catch(function ignore() {
    return [] as string[];
  });
  return entries.filter(function isSolidity(name) {
    return name.endsWith(".sol");
  });
}

async function frontEndSources(workspace: string): Promise<Array<{ path: string; text: string }>> {
  const found: Array<{ path: string; text: string }> = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(function ignore() {
      return [];
    });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) {
        continue;
      }
      const full = join(dir, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, path);
      } else if (/\.(tsx?|jsx?|html)$/.test(entry.name)) {
        const info = await stat(full).catch(function ignore() {
          return null;
        });
        if (info && info.size <= MAX_SOURCE_BYTES) {
          found.push({ path, text: await readFile(full, "utf8") });
        }
      }
    }
  }
  await walk(join(workspace, "src"), "src");
  const index = await readFile(join(workspace, "index.html"), "utf8").catch(function ignore() {
    return null;
  });
  if (index) {
    found.push({ path: "index.html", text: index });
  }
  return found;
}

// What in the workspace contradicts the verdict. Empty when the agent obeyed.
export async function needsViolations(workspace: string, verdict: NeedsVerdict): Promise<string[]> {
  const violations: string[] = [];
  if (!verdict.contract) {
    const sources = await solidityFiles(workspace);
    if (sources.length > 0) {
      violations.push(`a contract was written (${sources.join(", ")}) for an app that needs none`);
    }
  }
  if (!verdict.wallet) {
    const offending = (await frontEndSources(workspace)).filter(function connects(file) {
      return hasWalletCode(file.text);
    });
    if (offending.length > 0) {
      violations.push(`the front end connects a wallet (${offending.map((file) => file.path).join(", ")}) for an app where nothing is signed`);
    }
  }
  return violations;
}
