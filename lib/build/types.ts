// Pure types shared by the server builder and the client stream UI — no runtime
// imports, so this module is safe to import from a client component.
import type { NeedsVerdict } from "@/lib/agent/needs-rules";

export type BuildPhase =
  // The agent's own words while it works, as opposed to the file operations it
  // performs. Held back from the person until now, which is why a build read as
  // a silent list of writes.
  | "note"
  | "planning"
  | "scaffolding"
  | "compiling"
  | "testing"
  | "deploying"
  | "hosting"
  | "done"
  | "error";

export type ArtifactKind = "contract" | "app" | "config";

export interface BuildArtifact {
  contentHash?: string;
  path: string;
  kind: ArtifactKind;
  lines: number;
  // A short excerpt so the user sees real output rather than a filename alone.
  preview?: string;
}

// EIP-170: a deployed contract larger than this cannot be created on chain. Lives
// here rather than in the server-only foundry module so the build surface can plot
// a contract against the real limit.
export const CONTRACT_SIZE_LIMIT = 24_576;

// What the toolchain reported, not what the model claimed. These travel to the
// client so the build surface can show solc's actual verdict.
export interface Diagnostic {
  severity: "error" | "warning";
  message: string;
  file?: string;
}

export interface ContractSummary {
  name: string;
  source: string;
  // Deployed (runtime) size — the figure EIP-170's 24,576-byte cap applies to.
  bytecodeBytes: number;
  functions: number;
  events: number;
  abi: unknown[];
}

export interface CompileReport {
  ok: boolean;
  solc: string;
  contracts: ContractSummary[];
  errors: Diagnostic[];
  warnings: number;
  durationMs: number;
}

export interface TestCase {
  name: string;
  suite: string;
  passed: boolean;
  gas: number | null;
  reason?: string;
}

export interface TestReport {
  exitCode?: number;
  total: number;
  passed: number;
  failed: number;
  cases: TestCase[];
  durationMs: number;
}

export interface BuildEvent {
  stopping?: boolean;
  // Image-owned template version reported before project code runs.
  templateVersion?: string | null;
  phase: BuildPhase;
  text: string;
  // When the server recorded the event (ISO), so a reopened page shows the
  // real timeline rather than the moment of its own reload.
  at?: string;
  // The needs analysis (contract? wallet?) carried on the planning event that
  // announces it; `needsOverridden` marks the event that reports the agent
  // kept what the verdict said it should not have.
  needs?: NeedsVerdict;
  needsOverridden?: boolean;
  // Bounded output recorded for this call; old events may lack a call identity.
  toolCallId?: string;
  toolOutput?: string;
  toolOutputTruncated?: boolean;
  toolOutputChars?: number;
  // What did not happen and why, on the done event: not deployed, not
  // published, not verified. The UI turns these into an action card.
  notes?: string[];
  artifact?: BuildArtifact;
  contractAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  previewUrl?: string;
  draftReady?: boolean;
  // Blockscout's own answer after a deploy; absent when no verification ran.
  verified?: boolean;
  verifyError?: string;
  // The deployed contract itself: which one, its ABI, and the hash of the
  // bytecode that went on chain. Carried on the deploy event and the done event.
  contractName?: string;
  abi?: unknown[];
  bytecodeHash?: string;
  // The creation bytecode itself, on the done event, so it can be stored.
  bytecode?: string;
  // The wallet the constructor was given as owner, when it takes one.
  owner?: string;
  // True when the bytecode matched the previous deploy and the address was kept.
  reusedDeploy?: boolean;
  compile?: CompileReport;
  tests?: TestReport;
  analysis?: AnalysisReport;
}

// What the static analyser said about the contracts, severity by severity.
// `blocking` counts the findings the build refuses to deploy with.
export interface AnalysisFinding {
  check: string;
  impact: "High" | "Medium" | "Low" | "Informational" | "Optimization";
  confidence: string;
  description: string;
  file: string | null;
  line: number | null;
}

export interface AnalysisReport {
  tool: "slither";
  version: string | null;
  ran: boolean;
  // Why it did not run, when it did not: the image lacks the tool, or it failed.
  skipped: string | null;
  findings: AnalysisFinding[];
  blocking: number;
}

// A text file someone attached to a brief. Content is the file as typed, not a
// path: the workspace is written from it, so a build that restarts on another
// machine writes the same file.
export interface BuildTextAttachment {
  kind?: "text";
  name: string;
  content: string;
}
export interface BuildImageAttachment {
  kind: "image";
  name: string;
  mediaType: "image/png" | "image/jpeg";
  data: string;
}
export type BuildAttachment = BuildTextAttachment | BuildImageAttachment;

export interface BuildInput {
  buildId: string;
  prompt: string;
  slug: string;
  // Written into `brief/` in the workspace before the agent's first turn.
  attachments?: BuildAttachment[];
  // Filled by the runner from earlier submissions, never from agent-written files.
  restoredBriefs?: string[];
  // Original objective and latest prior request, ordered oldest first.
  projectRequests?: string[];
  // Bounded server-recorded conversation, task list and prior outcomes.
  projectConversation?: string;
  // The project's last deployed contract, so a follow-up build that leaves the
  // bytecode unchanged keeps its address instead of deploying a copy.
  previousContract?: { address: string; bytecodeHash: string } | null;
  previousBuildSucceeded?: boolean;
  // The wallet that owns whatever this build deploys: the constructor's one
  // argument. Fletch's key pays the gas and is never the owner.
  ownerAddress: string | null;
}

// The seam where E2B + claude-code + Blockscout + Workers-for-Platforms plug in.
// The stub implementation drives the same event stream so routes never change.
export interface Builder {
  run(input: BuildInput): AsyncIterable<BuildEvent>;
}
