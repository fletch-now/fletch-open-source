import { currentWorkerExecution } from "@/lib/build/durable/execution";
import { saveAgentContinuation } from "@/lib/build/durable/continuation";
import { appContext } from "@/lib/build/app-context";
import { contractEvidenceFailures, requiredTestsFailure } from "@/lib/build/completion";
import { needsAnalysisContext, projectRequestContext } from "@/lib/agent/needs-context";
import { checkBuildCancellation } from "@/lib/build/cancellation";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeAttachments } from "@/lib/build/write-attachments";
import { runAgentCli } from "@/lib/agent/cli-runner";
import { prepareDesignContext } from "@/lib/agent/design-directions";
import { agentTaskPrompt, followUpPrompt, repairPrompt, securityRepairPrompt, withBuildFacts } from "@/lib/agent/chain-facts";
import { walletFoundationViolations, WALLET_FOUNDATION_REPAIR } from "@/lib/agent/wallet-foundation";
import { analyseNeeds, needsViolations } from "@/lib/agent/needs-analysis";
import { needsDirective, needsLine, needsRepairPrompt, type NeedsVerdict } from "@/lib/agent/needs-rules";
import { analyseContracts } from "@/lib/build/analysis";
import { compile, runTests, writeFoundryConfig } from "@/lib/build/foundry";
import type { ProviderConfig } from "@/lib/agent/provider";
import type { BuildCost } from "@/lib/build/kimi-builder";
import type { BuildEvent, BuildInput, Builder } from "@/lib/build/types";
import { listWorkspaceArtifacts } from "@/lib/build/workspace-files";
import { deployToTestnet } from "@/lib/build/deploy";
import { verifyOnBlockscout } from "@/lib/build/verify";
import { buildWebApp, hasFrontEnd, sandboxTemplateVersion } from "@/lib/build/web";
import { publishSite } from "@/lib/hosting/publish";
import { prepareSiteDraft } from "@/lib/hosting/drafts";
import { PUBLIC_RPC_URLS } from "@/lib/chain/rpc";
import { explorerBaseUrl } from "@/lib/chain/explorer";
import { RH_TESTNET_ID } from "@/lib/config";
import { directoryBytes, workspaceMaxBytes } from "@/lib/build/workspace";

async function listSources(workspace: string): Promise<string[]> {
  const entries = await readdir(join(workspace, "contracts")).catch(function ignore() {
    return [] as string[];
  });
  return entries.filter(function isSolidity(name) {
    return name.endsWith(".sol");
  });
}

export interface CliBuilderOptions {
  provider: ProviderConfig;
  workspaceRoot: string;
  onCost?: (cost: BuildCost) => void;
  onSession?: (sessionId: string) => void | Promise<void>;
  onModel?: (model: string) => void;
  // The needs verdict, once decided and again if the agent overrode it.
  onNeeds?: (verdict: NeedsVerdict, overridden: boolean) => void;
  // Hands the runner a way to kill the container of the phase in progress.
  onStop?: (stop: () => void) => void;
  onBroadcast?: (txHash: string) => Promise<void>;
  resumeSessionId?: string;
  manualPublish?: boolean;
}

// The real runtime: an agent CLI running in a workspace on the server, with tools.
// It can write files, run the toolchain, read the errors and try again — the loop
// a single chat completion cannot do.
// Carries what one agent turn learns into the next: the session to resume, and the
// sentence the agent ended on.
interface TurnState {
  outputLimitRecoveryUsed?: boolean;
  recoveryContext?: string;
  designContext?: string;
  summary: string;
  sessionId?: string;
}

// Stop oversized work without destroying prior project files or session state.
// Retention and storage admission are separate from whether this turn may run.
export async function overDiskCap(workspace: string): Promise<boolean> {
  return await directoryBytes(workspace) > workspaceMaxBytes();
}

// The words a person uses when they do want the contract gone or replaced.
const REMOVAL_WORDS = /\b(remove|delete|replace|instead of|start over|scrap|rewrite from scratch|throw away|get rid of|different app|new app)\b/i;

function asksForRemoval(prompt: string): boolean {
  return REMOVAL_WORDS.test(prompt);
}

interface InitialAgentContinuation extends Record<string, unknown> {
  phase: "initial_agent"; contractsBefore: string[]; followUp: boolean; verdict: NeedsVerdict;
  kept: { contracts: Array<[string, string]>; tests: Array<[string, string]> }; state: TurnState;
}

interface KeptContracts {
  contracts: Map<string, string>;
  tests: Map<string, string>;
}

async function keepContracts(workspace: string, names: string[]): Promise<KeptContracts> {
  const kept: KeptContracts = { contracts: new Map(), tests: new Map() };
  for (const name of names) {
    const source = await readFile(join(workspace, "contracts", name), "utf8").catch(function none() {
      return null;
    });
    if (source !== null) {
      kept.contracts.set(name, source);
    }
    const testName = name.replace(/\.sol$/, ".t.sol");
    const test = await readFile(join(workspace, "test", testName), "utf8").catch(function none() {
      return null;
    });
    if (test !== null) {
      kept.tests.set(testName, test);
    }
  }
  return kept;
}

async function restoreContracts(workspace: string, kept: KeptContracts, names: string[]): Promise<void> {
  await mkdir(join(workspace, "contracts"), { recursive: true });
  await mkdir(join(workspace, "test"), { recursive: true });
  for (const name of names) {
    const source = kept.contracts.get(name);
    if (source !== undefined) {
      await writeFile(join(workspace, "contracts", name), source);
    }
    const testName = name.replace(/\.sol$/, ".t.sol");
    const test = kept.tests.get(testName);
    if (test !== undefined) {
      await writeFile(join(workspace, "test", testName), test);
    }
  }
}

function restorePrompt(restored: string[], request: string): string {
  return `You deleted ${restored.join(", ")} and the request did not ask for that, so Fletch put ${restored.length === 1 ? "it" : "them"} back, with ${restored.length === 1 ? "its" : "their"} tests. Any contract you wrote in its place must go: this app keeps its original contract. Now make the change the request actually asks for inside the app that exists, keep the front end talking to the original contract, run forge build and forge test until both pass, and reply with one sentence.

The request was:
${request}`;
}

export const TOOLCHAIN_MARKER = "Checked by the toolchain: ";

// The agent's own words come first, because a person reads them; the
// toolchain's verdict follows on its own line, labelled, because that is the
// part that was measured rather than said.
function composeDone(summary: string, facts: string[]): string {
  const verdict = `${TOOLCHAIN_MARKER}${facts.join(" ")}`;
  return summary.trim() ? `${summary.trim()}\n\n${verdict}` : verdict;
}

const DISK_CAP_MESSAGE = `The build wrote more than ${Math.round(workspaceMaxBytes() / (1024 * 1024))} MB to disk and was stopped. Provider usage may still be billed.`;

const CONTINUE_AGENT_PROMPT = "Continue the task already in this session from the last completed step. Inspect the saved files and tool results before acting. Do not repeat completed work. Finish the requested app and its checks.";

// A clean segment keeps the same task and session. Every new segment receives
// a fresh credential lease and passes the cumulative allowance guard.
async function* runTurn(
  options: CliBuilderOptions,
  workspace: string,
  prompt: string,
  state: TurnState,
): AsyncIterable<BuildEvent> {
  let nextPrompt = prompt;
  while (true) {
    let boundary = false;
    let outputLimited = false;
    let turnFailed = false;
    for await (const event of runAgentCli({
      workspace,
      prompt: withBuildFacts((options.manualPublish ?? process.env.FORGE_MANUAL_PUBLISH === "1")
        ? `${nextPrompt}\n\nFletch saves a preview after the checks pass. The owner publishes with the Publish live app button. Describe changes made; do not claim this version is already public.`
        : nextPrompt, state.designContext),
      provider: options.provider,
      resumeSessionId: state.sessionId,
      onStop: options.onStop,
    })) {
      if (event.kind === "boundary") boundary = true;
      if (event.kind === "init" && event.sessionId) {
        state.sessionId = event.sessionId;
        await options.onSession?.(event.sessionId);
      }
      if (event.kind === "error") {
        if (event.modelFailure === "output_limit" && currentWorkerExecution() && !state.outputLimitRecoveryUsed) {
          outputLimited = true;
          continue;
        }
        turnFailed = true;
        yield { phase: "error", text: event.text ?? "The build agent failed." };
        continue;
      }
      if (event.kind === "text" && event.text) {
        // Kept as the summary, and also shown as it arrives: the agent explaining
        // what it is about to do is the only thing that makes a five-minute wait
        // between two writes legible.
        state.summary = event.text;
        yield { phase: "note", text: event.text };
      }
      if (event.kind === "tool") {
        const label = event.toolPath || (event.tool ?? "step");
        yield { phase: "scaffolding", text: `${event.tool}: ${label}`, toolCallId: event.toolCallId };
      }
      if (event.kind === "tool_result") {
        yield {
          phase: "scaffolding",
          text: event.text ?? "",
          toolCallId: event.toolCallId,
          toolOutput: event.output ?? "",
          toolOutputTruncated: event.outputTruncated,
          toolOutputChars: event.outputChars,
        };
      }
      if (event.kind === "result") {
        if (event.usageMissing) options.onCost?.({ inputTokens: 0, outputTokens: 0, usd: 0, model: options.provider.model, usageComplete: false });
        if (event.costUsd !== undefined) {
          options.onCost?.({
            inputTokens: event.inputTokens ?? 0,
            outputTokens: event.outputTokens ?? 0,
            usd: event.costUsd,
            model: options.provider.model,
          });
        }
        if (event.text) {
          state.summary = event.text;
        }
      }
    }
    const execution = currentWorkerExecution();
    if (outputLimited && !turnFailed) {
      // Iteration has fully drained: the CLI is closed and the durable adapter
      // has receipted the response and saved its after-turn source checkpoint.
      checkBuildCancellation();
      if (await overDiskCap(workspace)) { yield { phase: "error", text: DISK_CAP_MESSAGE }; return; }
      state.outputLimitRecoveryUsed = true;
      state.sessionId = undefined;
      if (execution) execution.cleanSession = undefined;
      yield { phase: "planning", text: "The model reached its output limit. Source saved; continuing once with smaller file writes." };
      nextPrompt = `${state.recoveryContext ?? ""}

${prompt}

The previous turn ended at the model output limit. Its incomplete tool call was not executed. Inspect the saved source and finish only the remaining work. Use smaller, complete patches or append complete sections to fit the response budget. Existing files can remain large; do not split or repeat successfully saved work merely because of its size. This is the single continuation allowed for this output-limit failure.`;
      continue;
    }
    if (!boundary) return;
    if (execution?.continuationContext) await saveAgentContinuation(execution);
    if (await overDiskCap(workspace)) { yield { phase: "error", text: DISK_CAP_MESSAGE }; return; }
    yield { phase: "planning", text: "Progress saved. Continuing from the completed step." };
    nextPrompt = CONTINUE_AGENT_PROMPT;
  }
}

async function requiredSources(workspace: string, verdict: NeedsVerdict): Promise<string[]> {
  const failures: string[] = [];
  if (verdict.contract && (await listSources(workspace)).length === 0) failures.push("The required contract is missing from contracts/");
  if (!(await hasFrontEnd(workspace))) failures.push("The required front end is missing index.html");
  return failures;
}

function analysisLine(analysis: { ran: boolean; skipped: string | null; findings: Array<{ impact: string }>; blocking: number }): string {
  if (!analysis.ran) {
    return `Static analysis skipped: ${analysis.skipped}`;
  }
  const medium = analysis.findings.filter((finding) => finding.impact === "Medium").length;
  const low = analysis.findings.filter((finding) => finding.impact === "Low").length;
  if (analysis.findings.length === 0) {
    return "Slither found nothing to report";
  }
  return `Slither: ${analysis.blocking} high, ${medium} medium, ${low} low`;
}

interface FrontendCheck { ok: boolean; repaired: boolean; }

async function* checkFrontend(
  options: CliBuilderOptions, workspace: string, state: TurnState, verdict: NeedsVerdict,
  environment: Parameters<typeof buildWebApp>[1],
): AsyncGenerator<BuildEvent, FrontendCheck> {
  yield { phase: "compiling", text: "Checking the front end before deployment" };
  let repaired = false;
  let failed = false;
  let frontend = await buildWebApp(workspace, environment);
  if (!frontend.ok) {
    repaired = true;
    const error = frontend.skipped ? frontend.reason : frontend.error;
    yield { phase: "compiling", text: "The front end needs a fix. Sending the build error to the agent." };
    for await (const event of runTurn(options, workspace,
      `The frontend build failed: ${error}\n\nFix the frontend source using the actual files and relative import paths. Preserve the requested app, contracts, tests and shared wallet integration. Fletch will rerun the frontend build and contract checks before deployment.`, state)) {
      if (event.phase === "error") failed = true;
      yield event;
    }
    if (failed) return { ok: false, repaired };
    if (await overDiskCap(workspace)) {
      yield { phase: "error", text: DISK_CAP_MESSAGE };
      return { ok: false, repaired };
    }
    const repairFailures = [...await requiredSources(workspace, verdict), ...await needsViolations(workspace, verdict)];
    if (verdict.wallet) repairFailures.push(...await walletFoundationViolations(workspace));
    if (repairFailures.length > 0) {
      yield { phase: "error", text: `Frontend repair failed the app requirements: ${repairFailures.join("; ")}. Your files are saved.` };
      return { ok: false, repaired };
    }
    frontend = await buildWebApp(workspace, environment);
    if (!frontend.ok) {
      const reason = frontend.skipped ? frontend.reason : frontend.error;
      yield { phase: "error", text: `The front end did not build after repair: ${reason}. Your files are saved.` };
      return { ok: false, repaired };
    }
  }
  return { ok: true, repaired };
}

export class CliBuilder implements Builder {
  private readonly options: CliBuilderOptions;

  constructor(options: CliBuilderOptions) {
    this.options = options;
  }

  async *run(input: BuildInput): AsyncIterable<BuildEvent> {
    checkBuildCancellation();
    needsAnalysisContext(input);
    // Keyed by project slug, not build id: a follow-up run must land in the same
    // directory it built last time, and that is also where the agent's session store
    // lives. Slugs are globally unique.
    const workspace = join(this.options.workspaceRoot, input.slug);
    const existingFiles = (await listWorkspaceArtifacts(workspace)).map(function pathOf(artifact) {
      return artifact.path;
    });
    const context = appContext(existingFiles, input.previousBuildSucceeded || Boolean(input.previousContract));
    if (context.kind === "missing-source") {
      yield { phase: "error", text: "This project's saved app files are unavailable. Any previously published version is unchanged. Contact support before making another change." };
      return;
    }
    const execution = currentWorkerExecution();
    const restored = execution?.restoredContext as InitialAgentContinuation | undefined;
    const contractsBefore = restored?.contractsBefore ?? await listSources(workspace);
    const followUp = restored?.followUp ?? context.kind === "follow-up";
    const hasContract = Boolean(input.previousContract) || contractsBefore.length > 0;
    if (!restored && followUp && this.options.resumeSessionId) {
      yield { phase: "planning", text: "Continuing your saved model conversation. Checking the relevant files before making this change." };
    } else if (!restored && input.projectConversation) {
      yield { phase: "planning", text: "Restored saved requests, task lists and recorded progress for a new model session. Checking the unfinished work against your files." };
    }
    if (!restored && input.restoredBriefs?.length) {
      yield { phase: "planning", text: `Restored the saved brief before planning: ${input.restoredBriefs.join(", ")}.` };
    }
    if (!restored && !hasContract) yield { phase: "planning", text: "Reading your brief and planning the build." };
    const needs = restored ? { verdict: restored.verdict, cost: null } : await analyseNeeds(this.options.provider, input, hasContract);
    if (needs.cost) {
      this.options.onCost?.(needs.cost);
    }
    const verdict = needs.verdict;
    this.options.onNeeds?.(verdict, false);
    yield { phase: "planning", text: needsLine(verdict), needs: verdict };

    await mkdir(workspace, { recursive: true });
    const attached = await writeAttachments(workspace, input.attachments ?? []);
    if (attached.length > 0) yield { phase: "planning", text: `Attached to the brief: ${attached.join(", ")}` };
    await writeFoundryConfig(workspace);
    this.options.onModel?.(this.options.provider.model);
    yield { phase: "planning", text: followUp ? "Preparing your change" : "Preparing your new app", templateVersion: await sandboxTemplateVersion() };

    // The contract as it stands, kept aside so a follow-up that deletes it
    // without being asked can be undone rather than argued with.
    const kept = restored ? { contracts: new Map(restored.kept.contracts), tests: new Map(restored.kept.tests) } : await keepContracts(workspace, contractsBefore);

    const state: TurnState = { summary: "", sessionId: followUp ? this.options.resumeSessionId : undefined,
      designContext: await prepareDesignContext(workspace, input, input.slug, followUp) };
    if (restored) Object.assign(state, restored.state);

    let failed = false;
    let taskPrompt = CONTINUE_AGENT_PROMPT;
    const request = projectRequestContext(input);
    // The native session already contains its earlier turns and compaction
    // summary. Keep the full portable history for a fresh session or recovery,
    // but do not append that history again as a new user instruction.
    const agentRequest = state.sessionId
      ? `Continue from this session's conversation and pending tasks. The current request below takes precedence over earlier requests.\n\nCurrent request:\n${input.prompt}`
      : request;
    if (!restored) taskPrompt = followUp
      ? followUpPrompt(agentRequest, needsDirective(verdict), context.files, attached)
      : agentTaskPrompt(agentRequest, needsDirective(verdict), attached);
    if (!restored) state.recoveryContext = [
      "Continue this project's saved work. Inspect the current files and keep completed functionality while finishing the request.",
      `The user's request: ${request}`,
      needsDirective(verdict),
      attached.length ? `Read the complete saved brief before continuing: ${attached.join(", ")}. The current request takes precedence over older brief requirements.` : "",
      context.files.length ? `Existing app files: ${context.files.join(", ")}.` : "",
    ].filter(Boolean).join("\n\n");
    if (execution) execution.continuationContext = { phase: "initial_agent", contractsBefore, followUp, verdict,
      kept: { contracts: [...kept.contracts], tests: [...kept.tests] }, state } satisfies InitialAgentContinuation;
    for await (const event of runTurn(this.options, workspace, taskPrompt, state)) {
      if (event.phase === "error") {
        failed = true;
      }
      yield event;
    }
    if (failed) {
      return;
    }
    if (await overDiskCap(workspace)) {
      yield { phase: "error", text: DISK_CAP_MESSAGE };
      return;
    }

    if (execution) { execution.continuationContext = undefined; execution.cleanSession = undefined; }

    // A follow-up that removed a contract the request never asked to remove
    // gets it back, and the agent is told to fit its change around it.
    if (followUp && !asksForRemoval(input.prompt)) {
      const contractsAfter = await listSources(workspace);
      const removed = contractsBefore.filter(function gone(name) {
        return !contractsAfter.includes(name);
      });
      if (removed.length > 0) {
        await restoreContracts(workspace, kept, removed);
        yield { phase: "planning", text: `Restored ${removed.join(", ")}: the request did not ask to remove ${removed.length === 1 ? "it" : "them"}` };
        for await (const event of runTurn(this.options, workspace, restorePrompt(removed, input.prompt), state)) {
          if (event.phase === "error") {
            failed = true;
          }
          yield event;
        }
        if (failed) {
          return;
        }
      }
    }

    // One existing repair turn handles both negative needs violations and missing
    // required wallet integration. Cosmetic choices remain the user's decision.
    let walletViolations = verdict.wallet ? await walletFoundationViolations(workspace) : [];
    let violations = [...await needsViolations(workspace, verdict), ...await requiredSources(workspace, verdict), ...walletViolations];
    if (violations.length > 0) {
      yield { phase: "planning", text: `Verdict check: ${violations.join("; ")}. Asking the agent to fix it` };
      const walletRepair = walletViolations.length ? `\n\n${WALLET_FOUNDATION_REPAIR}` : "";
      for await (const event of runTurn(this.options, workspace, needsRepairPrompt(verdict, violations) + walletRepair, state)) {
        if (event.phase === "error") failed = true;
        yield event;
      }
      if (failed) return;
      if (await overDiskCap(workspace)) {
        yield { phase: "error", text: DISK_CAP_MESSAGE };
        return;
      }
      walletViolations = verdict.wallet ? await walletFoundationViolations(workspace) : [];
      if (walletViolations.length > 0) {
        yield { phase: "error", text: `Required shared wallet integration missing after repair: ${walletViolations.join("; ")}. Source files were retained.` };
        return;
      }
      violations = [...await needsViolations(workspace, verdict), ...await requiredSources(workspace, verdict)];
      if (violations.length > 0) {
        yield { phase: "error", text: `Required output check failed after repair: ${violations.join("; ")}. Source files were retained.` };
        return;
      } else {
        yield { phase: "planning", text: "Verdict check passed after the fix" };
      }
    } else {
      yield { phase: "planning", text: "Verdict check passed" };
    }

    const sources = await listSources(workspace);
    yield { phase: "compiling", text: "Compiling with solc" };
    let report = await compile(workspace, sources);

    // A toolchain is only worth having if the agent gets to act on what it says, so
    // real compiler errors go back to the same session for a repair round.
    const configuredRepairRounds = Number(process.env.FORGE_AGENT_REPAIR_ROUNDS ?? 1);
    const repairRounds = Number.isInteger(configuredRepairRounds) && configuredRepairRounds >= 0 ? Math.min(configuredRepairRounds, 1) : 1;
    for (let round = 0; round < repairRounds && (!report.ok || verdict.contract && report.contracts.length === 0); round += 1) {
      yield {
        phase: "compiling",
        text: report.ok ? "Writing the required contract missing from compiler output" : `Fixing ${report.errors.length} compiler ${report.errors.length === 1 ? "error" : "errors"}`,
        compile: report,
      };
      for await (const event of runTurn(this.options, workspace, repairPrompt(report.ok ? [{ message: "The required contract was not produced. Write its Solidity implementation in contracts/." }] : report.errors), state)) {
        if (event.phase === "error") {
          failed = true;
        }
        yield event;
      }
      if (failed) {
        return;
      }
      if (await overDiskCap(workspace)) {
        yield { phase: "error", text: DISK_CAP_MESSAGE };
        return;
      }
      report = await compile(workspace, await listSources(workspace));
    }

    yield {
      phase: "compiling",
      text: report.ok
        ? `Compiled ${report.contracts.length} ${report.contracts.length === 1 ? "contract" : "contracts"} with solc ${report.solc}`
        : `Compilation failed with ${report.errors.length} ${report.errors.length === 1 ? "error" : "errors"}`,
      compile: report,
    };

    const compileViolations = await needsViolations(workspace, verdict);
    if (compileViolations.length > 0) {
      yield { phase: "error", text: `The repaired output no longer matches the app requirements: ${compileViolations.join("; ")}. Source files were retained; the app was not published.` };
      return;
    }

    if (verdict.wallet) {
      const missingWallet = await walletFoundationViolations(workspace);
      if (missingWallet.length > 0) {
        yield { phase: "error", text: `Required shared wallet integration missing after repair: ${missingWallet.join("; ")}. Source files were retained; the app was not published.` };
        return;
      }
    }

    if (verdict.contract && report.ok && report.contracts.length === 0) {
      yield { phase: "error", text: "The required contract was not produced after repair. Source files were retained; the app was not published.", compile: report };
      return;
    }

    // forge exits 0 over an empty source set. When no new contract is required,
    // publication still needs a built frontend and a confirmed hosted release.
    if (report.ok && report.contracts.length === 0) {
      if (!(await hasFrontEnd(workspace))) {
        yield { phase: "error", text: "The agent did not produce a contract or a front end." };
        return;
      }
      const frontend = yield* checkFrontend(this.options, workspace, state, verdict, this.webEnvironment(undefined));
      if (!frontend.ok) return;
      for (const artifact of await listWorkspaceArtifacts(workspace)) {
        yield { phase: "scaffolding", text: artifact.path, artifact };
      }
      const done: BuildEvent = { phase: "done", text: composeDone(state.summary, ["Frontend built."]), compile: report };
      const site = yield* this.host(workspace, input, undefined);
      if (!site) return;
      Object.assign(done, site);
      if (site.draftReady) done.text = `Build ready. Preview your app, then select Publish live app to make it public.\n\n${done.text}`;
      yield done;
      return;
    }

    if (!report.ok) {
      // Do not hand the user code that does not compile, and do not charge for it —
      // the runner refunds the credit on a failed build.
      yield {
        phase: "error",
        text: report.errors[0]?.message ?? "The contract did not compile.",
      };
      return;
    }

    let tests = await runTests(workspace);
    if (tests) yield { phase: "testing", text: `${tests.passed}/${tests.total} tests passed`, tests };
    let testFailure = requiredTestsFailure(tests);
    if (testFailure) {
      yield { phase: "testing", text: `${testFailure} Asking the agent to repair the tests.` };
      const prompt = `${testFailure}

Implement meaningful Foundry tests for the required actions and failure cases, and fix the implementation when a test exposes a bug. Keep the requested app and its wallet integration. Run forge build and forge test until every test passes.

${JSON.stringify(tests?.cases ?? [])}`;
      for await (const event of runTurn(this.options, workspace, prompt, state)) {
        if (event.phase === "error") failed = true;
        yield event;
      }
      if (failed) return;
      if (await overDiskCap(workspace)) {
        yield { phase: "error", text: DISK_CAP_MESSAGE };
        return;
      }
      report = await compile(workspace, await listSources(workspace));
      yield { phase: "compiling", text: report.ok ? "Compiled the test repair" : "The test repair did not compile", compile: report };
      if (!report.ok || verdict.contract && report.contracts.length === 0) {
        yield { phase: "error", text: "The test repair did not produce the required compiled contract. Source files were retained." };
        return;
      }
      tests = await runTests(workspace);
      if (tests) yield { phase: "testing", text: `${tests.passed}/${tests.total} tests passed after repair`, tests };
      testFailure = requiredTestsFailure(tests);
      if (testFailure) {
        yield { phase: "error", text: `${testFailure} Source files were retained.` };
        return;
      }
    }

    // The static analyser reads every contract before anything is deployed. A
    // high-impact finding goes back to the agent once; if it stands, the build
    // fails rather than putting the contract on chain.
    yield { phase: "testing", text: "Static analysis with Slither" };
    let analysis = await analyseContracts(workspace);
    if (analysis.blocking > 0) {
      yield { phase: "testing", text: `Slither found ${analysis.blocking} high-impact ${analysis.blocking === 1 ? "issue" : "issues"}; asking the agent to fix them`, analysis };
      const blocking = analysis.findings.filter((finding) => finding.impact === "High");
      for await (const event of runTurn(this.options, workspace, securityRepairPrompt(blocking), state)) {
        if (event.phase === "error") {
          failed = true;
        }
        yield event;
      }
      if (failed) {
        return;
      }
      if (await overDiskCap(workspace)) {
        yield { phase: "error", text: DISK_CAP_MESSAGE };
        return;
      }
      report = await compile(workspace, await listSources(workspace));
      yield { phase: "compiling", text: report.ok ? "Compiled the security repair" : "The security repair did not compile", compile: report };
      if (!report.ok) {
        yield { phase: "error", text: `The security fix did not compile: ${report.errors[0]?.message ?? "unknown error"}` };
        return;
      }
      tests = await runTests(workspace);
      if (tests) yield { phase: "testing", text: `${tests.passed}/${tests.total} tests passed after the security fix`, tests };
      const securityTestFailure = requiredTestsFailure(tests);
      if (securityTestFailure) {
        yield { phase: "error", text: `${securityTestFailure} The security fix was not published.` };
        return;
      }
      analysis = await analyseContracts(workspace);
    }
    yield { phase: "testing", text: analysisLine(analysis), analysis };
    if (analysis.blocking > 0) {
      yield { phase: "error", text: `Not deployed: Slither still reports ${analysis.blocking} high-impact ${analysis.blocking === 1 ? "issue" : "issues"}. ${analysis.findings.find((finding) => finding.impact === "High")?.description.split("\n")[0] ?? ""}`.trim() };
      return;
    }

    if (verdict.wallet) {
      const missingWallet = await walletFoundationViolations(workspace);
      if (missingWallet.length > 0) {
        yield { phase: "error", text: `Required shared wallet integration missing after repair: ${missingWallet.join("; ")}. Source files were retained; the app was not published.` };
        return;
      }
    }

    const contractFailures = [...contractEvidenceFailures(verdict.contract, report, tests, analysis), ...await requiredSources(workspace, verdict), ...await needsViolations(workspace, verdict)];
    if (contractFailures.length > 0) {
      yield { phase: "error", text: `${contractFailures.join(" ")} Your files are saved.`, compile: report, tests: tests ?? undefined, analysis };
      return;
    }
    const frontend = yield* checkFrontend(this.options, workspace, state, verdict, this.webEnvironment(undefined));
    if (!frontend.ok) return;
    if (frontend.repaired) {
      // A model fixing JSX can also change Solidity. Recheck that final source
      // before deployment instead of reusing results from before the repair.
      report = await compile(workspace, await listSources(workspace));
      yield { phase: "compiling", text: "Rechecked contracts after frontend repair", compile: report };
      if (!report.ok || verdict.contract && report.contracts.length === 0) {
        yield { phase: "error", text: "The frontend repair did not retain the required compiled contract. Your files are saved." };
        return;
      }
      tests = await runTests(workspace);
      if (tests) yield { phase: "testing", text: `${tests.passed}/${tests.total} tests passed after frontend repair`, tests };
      const repairedTestFailure = requiredTestsFailure(tests);
      if (repairedTestFailure) {
        yield { phase: "error", text: `${repairedTestFailure} Your files are saved.` };
        return;
      }
      analysis = await analyseContracts(workspace);
      yield { phase: "testing", text: analysisLine(analysis), analysis };
    }

    const failures = [...contractEvidenceFailures(verdict.contract, report, tests, analysis), ...await requiredSources(workspace, verdict), ...await needsViolations(workspace, verdict)];
    if (failures.length > 0) {
      yield { phase: "error", text: `${failures.join(" ")} Source files were retained; the app was not published.`, compile: report, tests: tests ?? undefined, analysis };
      return;
    }

    // Report whatever landed on disk, which is the honest record of the run.
    for (const artifact of await listWorkspaceArtifacts(workspace)) {
      yield { phase: "scaffolding", text: artifact.path, artifact };
    }

    // A delivered app requires deployment and publication receipts. Failures keep
    // source and follow the already accepted failed-build refund agreement.
    const facts = [
      `Compiled ${report.contracts.length} ${report.contracts.length === 1 ? "contract" : "contracts"} with solc ${report.solc}.`,
      tests ? `${tests.passed} of ${tests.total} tests passed.` : "No tests were written.",
      `${analysisLine(analysis)}.`,
    ];
    const done: BuildEvent = { phase: "done", text: composeDone(state.summary, facts), compile: report, tests: tests ?? undefined, analysis };
    const notes: string[] = [];

    yield { phase: "deploying", text: "Deploying to Robinhood testnet" };
    const deployed = await deployToTestnet(workspace, report.contracts, input.previousContract ?? null, (input.ownerAddress as `0x${string}` | null) ?? null, this.options.onBroadcast);
    if (deployed.ok) {
      done.contractAddress = deployed.address;
      done.txHash = deployed.txHash ?? undefined;
      done.explorerUrl = deployed.explorerUrl;
      done.contractName = deployed.contractName;
      done.abi = deployed.abi as unknown[];
      done.bytecodeHash = deployed.bytecodeHash;
      done.bytecode = deployed.bytecode;
      done.owner = deployed.owner ?? undefined;
      done.reusedDeploy = deployed.reused;
      yield {
        phase: "deploying",
        text: deployed.reused
          ? `${deployed.contractName} unchanged, still at ${deployed.address}`
          : `${deployed.contractName} deployed at ${deployed.address}${deployed.owner ? `, owned by your wallet ${deployed.owner}` : ""}`,
        contractAddress: deployed.address,
        txHash: deployed.txHash ?? undefined,
        explorerUrl: deployed.explorerUrl,
        contractName: deployed.contractName,
        abi: deployed.abi as unknown[],
        bytecodeHash: deployed.bytecodeHash,
        bytecode: deployed.bytecode,
        owner: deployed.owner ?? undefined,
      };
      yield { phase: "deploying", text: "Verifying the source on the chain explorer" };
      const verification = await verifyOnBlockscout({
        workspace,
        chainId: RH_TESTNET_ID,
        address: deployed.address,
        contractPath: deployed.contractPath,
        contractName: deployed.contractName,
        solc: report.solc,
        constructorArgs: deployed.constructorArgs,
      });
      if (verification.ok) {
        done.verified = true;
        yield { phase: "deploying", text: "Source verified on the chain explorer", contractAddress: deployed.address, verified: true };
      } else {
        done.verified = false;
        done.verifyError = verification.error;
        yield { phase: "deploying", text: `Not verified: ${verification.error}`, contractAddress: deployed.address, verified: false, verifyError: verification.error };
        notes.push(`Not verified on the chain explorer: ${verification.error}`);
      }
    } else {
      const why = deployed.skipped ? deployed.reason : deployed.error;
      yield { phase: "deploying", text: `Not deployed: ${why}` };
      yield { phase: "error", text: "The contract could not be deployed. Your files are saved." };
      return;
    }

    const site = yield* this.host(workspace, input, deployed.address);
    if (!site) return;
    Object.assign(done, site);
    if (site.draftReady) done.text = `Build ready. Preview your app, then select Publish live app to make it public.\n\n${done.text}`;

    if (notes.length > 0) {
      done.text = `${done.text}\n\n${notes.join("\n")}`;
      done.notes = notes;
    }
    yield done;
  }

  // The rollout flag lets an old worker finish its accepted automatic builds.
  // New manual builds keep their final bundle until the owner publishes it.
  private async *host(
    workspace: string,
    input: BuildInput,
    contractAddress: string | undefined,
  ): AsyncGenerator<BuildEvent, { previewUrl?: string; draftReady?: true } | undefined> {
    if (!(await hasFrontEnd(workspace))) {
      yield { phase: "error", text: "The required front end was not produced. Your files are saved." };
      return;
    }
    yield { phase: "hosting", text: "Building the front end" };
    // The page runs in a visitor's browser, so it gets the public RPC: a
    // configured provider URL carries a key, and the hosted CSP only admits
    // the public hosts anyway.
    const web = await buildWebApp(workspace, this.webEnvironment(contractAddress));
    if (!web.ok) {
      const why = web.skipped ? web.reason : `The front end did not build: ${web.error}`;
      yield { phase: "error", text: `${why} Your files are saved.` };
      return;
    }
    yield { phase: "hosting", text: `Front end built, ${(web.bytes / 1024).toFixed(0)} KB in ${web.files} files.`, templateVersion: web.templateVersion };
    if (this.options.manualPublish ?? process.env.FORGE_MANUAL_PUBLISH === "1") {
      await prepareSiteDraft(input.buildId, join(workspace, "dist"));
      yield { phase: "hosting", text: "Preview saved. Select Publish live app when you want it public.", draftReady: true };
      return { draftReady: true };
    }
    const published = await publishSite(input.slug, input.buildId, join(workspace, "dist"), web.bytes);
    if (!published.ok) {
      yield { phase: "error", text: `${published.error} Your files are saved.` };
      return;
    }
    yield { phase: "hosting", text: `Live at ${published.url}`, previewUrl: published.url };
    return { previewUrl: published.url };
  }

  private webEnvironment(contractAddress: string | undefined): Parameters<typeof buildWebApp>[1] {
    return {
      contractAddress,
      chainId: RH_TESTNET_ID,
      rpcUrl: PUBLIC_RPC_URLS[RH_TESTNET_ID],
      explorerUrl: explorerBaseUrl(RH_TESTNET_ID),
      walletConnectProjectId: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
    };
  }
}
