import { RH_TESTNET_ID } from "@/lib/config";
import { analyseNeeds } from "@/lib/agent/needs-analysis";
import { needsDirective, needsLine } from "@/lib/agent/needs-rules";
import { streamChat } from "@/lib/agent/chat";
import { costUsd, type ProviderConfig } from "@/lib/agent/provider";
import { chooseDesignDirection, designDirectionContext, PRESERVE_DESIGN_CONTEXT } from "@/lib/agent/design-directions";
import { needsAnalysisContext } from "@/lib/agent/needs-context";
import { BUILD_SYSTEM_PROMPT } from "@/lib/agent/chain-facts";
import { CODE_SIMPLIFIER_STANDARD } from "@/lib/agent/code-simplifier";
import type { ArtifactKind, BuildEvent, BuildInput, Builder } from "@/lib/build/types";

interface GeneratedFile {
  path: string;
  kind: ArtifactKind;
  content: string;
}

const KINDS: ArtifactKind[] = ["contract", "app", "config"];

function asKind(value: unknown): ArtifactKind {
  return KINDS.includes(value as ArtifactKind) ? (value as ArtifactKind) : "app";
}

// Models wrap JSON in prose or fences despite instructions, so take the outermost
// object rather than trusting the whole response to parse.
function parseFiles(raw: string): { summary: string; files: GeneratedFile[] } {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The model did not return a usable file set.");
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    summary?: string;
    files?: Array<{ path?: string; kind?: string; content?: string }>;
  };
  const files = (parsed.files ?? [])
    .filter(function isUsable(file) {
      return Boolean(file.path && file.content);
    })
    .map(function normalize(file) {
      return {
        path: String(file.path),
        kind: asKind(file.kind),
        content: String(file.content),
      };
    });
  if (files.length === 0) {
    throw new Error("The model returned no files.");
  }
  return { summary: parsed.summary ?? "Generated a Robinhood Chain dapp.", files };
}

function excerpt(content: string): string {
  return content.split("\n").slice(0, 12).join("\n");
}

export interface BuildCost {
  usageComplete?: boolean;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  model: string;
}

// Generates a dapp with a real model call. Compilation, deployment and hosting are
// still ahead of this seam — the address below is a placeholder until the Foundry
// sandbox lands, and the UI labels it as such.
export class KimiBuilder implements Builder {
  private readonly config: ProviderConfig;
  private readonly onCost?: (cost: BuildCost) => void;

  constructor(config: ProviderConfig, onCost?: (cost: BuildCost) => void) {
    this.config = config;
    this.onCost = onCost;
  }

  async *run(input: BuildInput): AsyncIterable<BuildEvent> {
    yield { phase: "planning", text: "Planning the app" };
    const analysis = await analyseNeeds(this.config, input, Boolean(input.previousContract));
    if (analysis.cost) {
      this.onCost?.(analysis.cost);
    }
    yield { phase: "planning", text: needsLine(analysis.verdict), needs: analysis.verdict };

    const designContext = input.previousContract || input.previousBuildSucceeded
      ? PRESERVE_DESIGN_CONTEXT
      : designDirectionContext(chooseDesignDirection(input, input.slug));
    const result = await streamChat(
      this.config,
      [
        { role: "system", content: `${BUILD_SYSTEM_PROMPT}\n\n${designContext}\n\n${CODE_SIMPLIFIER_STANDARD}` },
        { role: "user", content: [needsAnalysisContext(input), needsDirective(analysis.verdict)].filter(Boolean).join("\n\n") },
      ],
      { maxTokens: 8000 },
    );

    this.onCost?.({
      usageComplete: result.usage !== null,
      inputTokens: result.usage?.inputTokens ?? 0,
      outputTokens: result.usage?.outputTokens ?? 0,
      usd: result.usage ? costUsd(this.config, result.usage.inputTokens, result.usage.outputTokens) : 0,
      model: this.config.model,
    });

    const { summary, files } = parseFiles(result.text);
    yield { phase: "scaffolding", text: summary };

    for (const file of files) {
      yield {
        phase: "scaffolding",
        text: file.path,
        artifact: {
          path: file.path,
          kind: file.kind,
          lines: file.content.split("\n").length,
          preview: excerpt(file.content),
        },
      };
    }

    const contract = files.find(function isContract(file) {
      return file.kind === "contract";
    });
    if (contract) {
      yield { phase: "compiling", text: `Wrote ${contract.path}` };
    }

    // Placeholder until the Foundry sandbox exists; the address is not on-chain.


    yield { phase: "deploying", text: `Prepared for testnet ${RH_TESTNET_ID} (deploy pending)` };
    yield {
      phase: "done",
      text: "Generated.",
    };
  }
}
