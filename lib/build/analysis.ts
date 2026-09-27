import { workerOperation } from "@/lib/build/durable/execution";
import "server-only";
import type { AnalysisFinding, AnalysisReport } from "@/lib/build/types";
import { runTool } from "@/lib/build/foundry";
import { logEvent } from "@/lib/log";

// Slither over the workspace, inside the sandbox, offline. Its detectors are
// the closest thing to an audit that runs on every build: reentrancy,
// unchecked calls, dangerous delegatecall, tx.origin, uninitialised storage,
// arbitrary sends. High-impact findings block the deploy; the rest are shown.
// The tool's own words are kept; nothing here paraphrases a finding.

// The filter is a regex over the path; unanchored, "lib" would also match a
// contract named Liberty.sol or calibrate.sol and drop it from the scan.
const ARGS = ["slither", ".", "--json", "-", "--exclude-informational", "--exclude-optimization", "--filter-paths", "^(test|lib|forge-std)/"];
const BLOCKING_IMPACTS = new Set(["High"]);

interface RawDetector {
  check?: string;
  impact?: string;
  confidence?: string;
  description?: string;
  elements?: Array<{ source_mapping?: { filename_relative?: string; lines?: number[] } }>;
}

function extractJson(text: string): { success?: boolean; error?: string | null; results?: { detectors?: RawDetector[] } } | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return null;
  }
}

function toFinding(raw: RawDetector): AnalysisFinding {
  const element = raw.elements?.[0]?.source_mapping;
  const impact = raw.impact ?? "Low";
  return {
    check: raw.check ?? "unknown",
    impact: impact === "High" || impact === "Medium" || impact === "Low" || impact === "Informational" || impact === "Optimization" ? impact : "Low",
    confidence: raw.confidence ?? "",
    description: (raw.description ?? "").trim(),
    file: element?.filename_relative ?? null,
    line: element?.lines?.[0] ?? null,
  };
}

function skipped(reason: string): AnalysisReport {
  return { tool: "slither", version: null, ran: false, skipped: reason, findings: [], blocking: 0 };
}

async function analyseContractsInternal(workspace: string): Promise<AnalysisReport> {
  const version = await runTool(workspace, ["slither", "--version"]);
  if (version.code !== 0) {
    return skipped("The sandbox image has no static analyser; rebuild it from docker/agent.Dockerfile.");
  }
  const run = await runTool(workspace, ARGS);
  const parsed = extractJson(run.stdout);
  if (!parsed) {
    logEvent("analysis", { event: "no-json", code: run.code, stderr: run.stderr.slice(-300) });
    return skipped(`The analyser produced no result: ${run.stderr.trim().split("\n").slice(-1)[0]?.slice(0, 200) || "no output"}`);
  }
  if (parsed.success === false) {
    return skipped(`The analyser failed: ${(parsed.error ?? "").slice(0, 200)}`);
  }
  const findings = (parsed.results?.detectors ?? []).map(toFinding);
  const blocking = findings.filter((finding) => BLOCKING_IMPACTS.has(finding.impact)).length;
  logEvent("analysis", { event: "ran", findings: findings.length, blocking });
  return { tool: "slither", version: version.stdout.trim() || null, ran: true, skipped: null, findings, blocking };
}

export async function analyseContracts(workspace: string): Promise<AnalysisReport> {
  return workerOperation("security", "tool", () => analyseContractsInternal(workspace));
}
