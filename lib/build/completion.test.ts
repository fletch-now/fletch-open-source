import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { withWorkerExecution, type BuildExecution } from "./durable/execution";
import { withBuildCancellation } from "./cancellation";
import { appContext } from "./app-context";
import { requiredTestsFailure } from "./completion";
import { needsAnalysisContext } from "@/lib/agent/needs-context";
import { needsViolations } from "@/lib/agent/needs-analysis";
import type { CliBuilderOptions } from "./cli-builder";
import type { BuildEvent, BuildInput, Builder, CompileReport, TestReport } from "./types";

test("new-app context excludes briefs, manifests, server configuration and tests-only attempts", function context() {
  const attempt = ["brief/launchpad.md", "fletch.project.json", "fletch.deploy.json", "foundry.toml", "vite.config.mts", "test/Example.t.sol", "fletch/wallet.tsx"];
  assert.equal(appContext(attempt).kind, "new");
  assert.equal(appContext(attempt, true).kind, "missing-source");
  assert.deepEqual(appContext([...attempt, "src/App.tsx"]), { kind: "follow-up", files: ["src/App.tsx"] });
  assert.equal(appContext(["contracts/Token.sol"]).kind, "follow-up");
});

test("required tests reject absence, empty suites, failed cases and abnormal process exit", function tests() {
  assert.match(requiredTestsFailure(null)!, /no executable/);
  assert.match(requiredTestsFailure({ total: 0, passed: 0, failed: 0, cases: [], durationMs: 0 })!, /no executable/);
  assert.match(requiredTestsFailure({ total: 2, passed: 1, failed: 1, cases: [], durationMs: 0, exitCode: 1 })!, /1 of 2/);
  assert.match(requiredTestsFailure({ total: 2, passed: 2, failed: 0, cases: [], durationMs: 0, exitCode: 1 })!, /execution failed/);
  assert.equal(requiredTestsFailure({ total: 2, passed: 2, failed: 0, cases: [], durationMs: 0, exitCode: 0 }), null);
});

const MOCK_MODULES: Record<string, string> = {
  "server-only": "",
  "@/lib/agent/cli-runner": "export const runAgentCli = fixture.runAgentCli;",
  "@/lib/agent/needs-analysis": "export const analyseNeeds = fixture.analyseNeeds; export const needsViolations = fixture.needsViolations;",
  "@/lib/agent/wallet-foundation": "export const walletFoundationViolations = fixture.walletFoundationViolations; export const WALLET_FOUNDATION_REPAIR = 'Restore the required shared wallet integration.';",
  "@/lib/build/foundry": "export const compile = fixture.compile; export const runTests = fixture.runTests; export async function writeFoundryConfig() {}",
  "@/lib/build/analysis": "export const analyseContracts = fixture.analyseContracts;",
  "@/lib/build/deploy": "export const deployToTestnet = fixture.deployToTestnet;",
  "@/lib/build/verify": "export const verifyOnBlockscout = fixture.verifyOnBlockscout;",
  "@/lib/build/web": "export const buildWebApp = fixture.buildWebApp; export const hasFrontEnd = fixture.hasFrontEnd; export async function sandboxTemplateVersion() { return 'fixture'; }",
  "@/lib/hosting/publish": "export const publishSite = fixture.publishSite;",
};

async function bundleBuilder(): Promise<string> {
  const result = await build({
    stdin: { contents: 'export { CliBuilder } from "@/lib/build/cli-builder";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.FORGE_AGENT_REPAIR_ROUNDS": '"1"' },
    plugins: [{ name: "controlled-build-services", setup(plugin) {
      plugin.onResolve({ filter: /^(server-only|@\/)/ }, function resolve(args) {
        if (Object.hasOwn(MOCK_MODULES, args.path)) return { path: args.path, namespace: "fixture" };
      });
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({ contents: MOCK_MODULES[args.path], loader: "js" }));
    } }],
  });
  return result.outputFiles[0].text;
}

const bundled = bundleBuilder();
const scenarios = ["frontend-repaired", "frontend-repair-contract-failed", "frontend-repair-tests-failed", "frontend-repair-security-failed", "frontend-late-failure", "frontend-wallet-removed", "new-brief", "brief-only", "follow-up", "follow-up-fresh", "missing-history-source", "missing-contract", "empty-compile", "missing-wallet", "missing-frontend", "missing-tests", "zero-tests", "failing-tests", "test-repaired", "security-latest", "security-deletes-tests", "analysis-unavailable", "deploy-failed", "web-failed", "publish-failed", "verify-failed-publish-failed", "read-only-success", "read-only-wallet-writer", "read-only-web-failed", "read-only-publish-failed", "read-only-compiler-contract", "read-only-compiler-wallet", "test-forbidden-wallet", "security-forbidden-wallet", "invalid-brief", "output-recovered", "output-repeated", "output-cleanup-failed", "output-stopped", "output-unknown"] as const;

for (const scenario of scenarios) {
  test(`actual CliBuilder completion and prompt order: ${scenario}`, async function pipeline(t) {
    const root = await mkdtemp(join(tmpdir(), "fletch-completion-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const workspace = join(root, "fixture");
    const attachedText = "Build a token launchpad with a new contract, wallet signing, buy/deadline/draw/claim and negative-case tests.\n".repeat(30);
    const stop = new AbortController();
    let turnClosed = false;
    const calls = { prompts: [] as string[], sessions: [] as Array<string | undefined>, classify: 0, compile: 0, tests: 0, analysis: 0, deploy: 0, web: 0, publish: 0 };
    if (scenario === "brief-only" || scenario.startsWith("follow-up")) {
      await mkdir(join(workspace, "brief"), { recursive: true });
      await writeFile(join(workspace, "brief", "earlier.md"), "An earlier attempt never produced an app.");
      await writeFile(join(workspace, "fletch.project.json"), '{"name":"Earlier attempt"}');
    }
    if (scenario.startsWith("follow-up")) await writeFile(join(workspace, "index.html"), "<main>Existing app</main>");
    const readOnly = scenario.startsWith("read-only");
    const forbiddenWallet = scenario.endsWith("forbidden-wallet");
    const compilerRepair = scenario.startsWith("read-only-compiler-");
    const fixture = {
      needsViolations,
      async analyseNeeds(_provider: unknown, input: BuildInput) {
        calls.classify++;
        assert.ok(needsAnalysisContext(input).includes(attachedText));
        await assert.rejects(readFile(join(workspace, "brief", "launchpad.md")), { code: "ENOENT" }, "Classification precedes writing this request's brief");
        return { verdict: { contract: !readOnly, wallet: scenario === "read-only-wallet-writer" || !readOnly && !forbiddenWallet, reason: "Controlled full-brief verdict", source: "model" } };
      },
      async *runAgentCli({ prompt, resumeSessionId }: { prompt: string; resumeSessionId?: string }) {
        if (calls.prompts.length && scenario.startsWith("output-")) {
          assert.ok(turnClosed, "The failed iterator must fully drain before another turn");
          assert.equal(resumeSessionId, undefined, "The partial session is not reused");
          assert.match(prompt, /Read the complete saved brief before continuing/);
          assert.match(prompt, /smaller, complete patches/);
          assert.match(prompt, /do not split or repeat successfully saved work/);
          assert.doesNotMatch(prompt, /below 8 KiB/);
        }
        calls.prompts.push(prompt);
        if (scenario.startsWith("follow-up") && calls.prompts.length === 1) {
          assert.match(prompt, /Build the attached spec\./, "The current request is retained completely");
          assert.match(prompt, /Layout and toolchain:/, "Resuming keeps the platform toolchain instructions");
          if (scenario === "follow-up-fresh") {
            assert.match(prompt, /Keep the forest theme/);
            assert.match(prompt, /Stylesheet is the next unfinished task/);
            assert.match(prompt, /Contract tests passed previously; recheck before release/);
          } else {
            assert.match(prompt, /Continue from this session's conversation and pending tasks/);
            assert.doesNotMatch(prompt, /Keep the forest theme|Stylesheet is the next unfinished task/,
              "A native resume does not append a second reconstructed copy of session history");
          }
        }
        calls.sessions.push(resumeSessionId);
        assert.equal(calls.classify, 1);
        assert.equal(await readFile(join(workspace, "brief", "launchpad.md"), "utf8"), attachedText);
        if (scenario !== "missing-frontend") await writeFile(join(workspace, "index.html"), "<main>Controlled app</main>");
        if (!readOnly && scenario !== "missing-contract") {
          await mkdir(join(workspace, "contracts"), { recursive: true });
          await writeFile(join(workspace, "contracts", "App.sol"), "contract App {}");
        }
        if (calls.prompts.length > 1) {
          if (scenario === "read-only-compiler-contract") {
            await mkdir(join(workspace, "contracts"), { recursive: true });
            await writeFile(join(workspace, "contracts", "Forbidden.sol"), "contract Forbidden {}");
          }
          if (forbiddenWallet || scenario === "read-only-compiler-wallet") await writeFile(join(workspace, "index.html"), '<script>createWalletClient({transport: injected()})</script>');
        }
        if (scenario.startsWith("output-") && (calls.prompts.length === 1 || scenario === "output-repeated")) {
          yield { kind: "init", sessionId: "partial-session-must-not-resume" };
          yield { kind: "error", modelFailure: scenario === "output-unknown" ? undefined : "output_limit",
            text: "The model reached its output limit during a tool request. Your source files are saved." };
          if (scenario === "output-cleanup-failed") throw new Error("Controlled after-turn cleanup/checkpoint failure");
          if (scenario === "output-stopped") stop.abort(new Error("Controlled Stop after close"));
          turnClosed = true;
          return;
        }
        yield { kind: "result", text: "Controlled model fixture completion." };
      },
      async walletFoundationViolations() { return scenario === "missing-wallet" || scenario === "frontend-wallet-removed" && calls.prompts.length > 1 ? ["Required shared wallet integration missing"] : []; },
      async compile(): Promise<CompileReport> {
        calls.compile++;
        if (scenario === "frontend-repair-contract-failed" && calls.compile > 1) return { ok: false, solc: "fixture", contracts: [], errors: [{ severity: "error", message: "Frontend repair changed Solidity incorrectly" }], warnings: 0, durationMs: 1 };
        if (compilerRepair && calls.compile === 1) return { ok: false, solc: "fixture", contracts: [], errors: [{ severity: "error", message: "Controlled compiler failure" }], warnings: 0, durationMs: 1 };
        return { ok: true, solc: `fixture-${calls.compile}`, contracts: readOnly || scenario === "empty-compile" ? [] : [{ name: "App", source: "contracts/App.sol", bytecodeBytes: calls.compile, abi: [], functions: 1, events: 0 }], errors: [], warnings: 0, durationMs: 1 };
      },
      async runTests(): Promise<TestReport | null> {
        calls.tests++;
        if (scenario === "frontend-repair-tests-failed" && calls.tests > 1) return { total: 2, passed: 1, failed: 1, cases: [], durationMs: 1, exitCode: 1 };
        if (scenario === "missing-tests" || scenario === "security-deletes-tests" && calls.tests > 1) return null;
        if (scenario === "zero-tests") return { total: 0, passed: 0, failed: 0, cases: [], durationMs: 1 };
        if (scenario === "failing-tests" || ["test-repaired", "test-forbidden-wallet"].includes(scenario) && calls.tests === 1) return { total: 2, passed: 1, failed: 1, cases: [], durationMs: 1, exitCode: 1 };
        const total = scenario === "security-latest" && calls.tests > 1 ? 3 : 2;
        return { total, passed: total, failed: 0, cases: [], durationMs: 1, exitCode: 0 };
      },
      async analyseContracts() {
        calls.analysis++;
        const blocking = (scenario.startsWith("security-") && calls.analysis === 1 || scenario === "frontend-repair-security-failed" && calls.analysis > 1) ? 1 : 0;
        return { tool: "slither", version: `fixture-${calls.analysis}`, ran: scenario !== "analysis-unavailable", skipped: scenario === "analysis-unavailable" ? "Controlled missing analyzer" : null, blocking, findings: blocking ? [{ impact: "High", description: "Controlled issue" }] : [] };
      },
      async hasFrontEnd() { return readFile(join(workspace, "index.html")).then(() => true, () => false); },
      async deployToTestnet() {
        assert.ok(calls.web >= 1, "Frontend must pass before deployment");
        calls.deploy++;
        return scenario === "deploy-failed" ? { ok: false, skipped: false, error: "Controlled deploy failure" } : { ok: true, address: "0x0000000000000000000000000000000000000001", contractName: "App", abi: [], bytecodeHash: "fixture", bytecode: "0x01" };
      },
      async verifyOnBlockscout() {
        return scenario === "verify-failed-publish-failed" ? { ok: false, error: "Controlled explorer failure" } : { ok: true };
      },
      async buildWebApp() {
        assert.ok(calls.compile > 0, "Independent compilation precedes frontend packaging");
        if (!readOnly) {
          assert.ok(calls.tests > 0, "Independent contract tests precede frontend packaging");
          assert.ok(calls.analysis > 0, "Independent security checks precede frontend packaging");
        }
        calls.web++;
        return scenario.endsWith("web-failed") || scenario.startsWith("frontend-") && calls.web === 1 || scenario === "frontend-late-failure" && calls.web === 2 ? { ok: false, skipped: false, error: "Controlled frontend failure" } : { ok: true, bytes: 1, files: 1, templateVersion: "fixture" };
      },
      async publishSite() {
        calls.publish++;
        return scenario.endsWith("publish-failed") ? { ok: false, error: "Controlled publication failure" } : { ok: true, url: "https://fixture.invalid", bytes: 1 };
      },
    };
    const compiled = { exports: {} as { CliBuilder: new (options: CliBuilderOptions) => Builder } };
    new Function("require", "module", "exports", "fixture", await bundled)(createRequire(`${process.cwd()}/package.json`), compiled, compiled.exports, fixture);
    const builder = new compiled.exports.CliBuilder({ workspaceRoot: root, manualPublish: false, resumeSessionId: scenario === "follow-up-fresh" ? undefined : "old-session", provider: { id: "kimi", baseUrl: "https://unused.invalid", apiKey: "fixture", model: "fixture", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true } });
    const input: BuildInput = { buildId: "fixture-build", slug: "fixture", prompt: "Build the attached spec.", ownerAddress: null, attachments: [{ name: "launchpad.md", content: attachedText }], previousBuildSucceeded: scenario.startsWith("follow-up") || scenario === "missing-history-source",
      projectConversation: scenario.startsWith("follow-up") ? "Keep the forest theme. Stylesheet is the next unfinished task. Contract tests passed previously; recheck before release." : undefined,
    };
    if (scenario === "invalid-brief") input.attachments = [{ name: "launchpad.md", content: "\0unreadable" }];
    const events: BuildEvent[] = [];
    const execution = { pool: null, claim: {}, signal: stop.signal, workspace, archiveRoot: root,
      nextOperation: 0, activeKey: null, containers: new Set() } as unknown as BuildExecution;
    async function collect(): Promise<void> {
      async function consume(): Promise<void> { for await (const event of builder.run(input)) events.push(event); }
      if (scenario.startsWith("output-")) await withWorkerExecution(execution, consume);
      else await consume();
    }
    if (scenario === "invalid-brief") {
      await assert.rejects(collect(), /complete brief could not be read/);
      assert.equal(calls.classify, 0);
      assert.equal(calls.prompts.length, 0);
      return;
    }
    if (scenario === "output-cleanup-failed" || scenario === "output-stopped") {
      await assert.rejects(withBuildCancellation(stop.signal, collect), /Controlled/);
      assert.equal(calls.prompts.length, 1);
      assert.equal(calls.deploy, 0);
      assert.equal(calls.publish, 0);
      return;
    }
    await collect();
    if (scenario === "publish-failed") {
      const verification = events.find((event) => event.verified === true);
      assert.equal(verification?.contractAddress, "0x0000000000000000000000000000000000000001", "Explorer confirmation carries its deployment identity before hosting can fail");
    }
    if (scenario === "verify-failed-publish-failed") {
      const verification = events.find((event) => event.verified === false);
      assert.equal(verification?.contractAddress, "0x0000000000000000000000000000000000000001");
      assert.equal(verification?.verifyError, "Controlled explorer failure");
    }
    const successful = ["frontend-repaired", "new-brief", "brief-only", "follow-up", "follow-up-fresh", "test-repaired", "security-latest", "read-only-success", "read-only-wallet-writer", "output-recovered"].includes(scenario);
    assert.equal(events.at(-1)?.phase, successful ? "done" : "error");
    assert.equal(events.some((event) => event.phase === "done"), successful);
    if (scenario === "missing-history-source") {
      assert.equal(calls.classify, 0);
      assert.equal(calls.prompts.length, 0);
      assert.match(events.at(-1)?.text ?? "", /Any previously published version is unchanged/);
      return;
    }
    if (scenario.startsWith("output-")) {
      assert.equal(calls.prompts.length, scenario === "output-unknown" ? 1 : 2);
      assert.equal(calls.deploy, scenario === "output-recovered" ? 1 : 0);
      assert.equal(calls.publish, scenario === "output-recovered" ? 1 : 0);
      assert.equal(events.filter((event) => event.phase === "error").length, scenario === "output-recovered" ? 0 : 1);
      if (scenario !== "output-recovered") assert.match(events.at(-1)?.text ?? "", /output limit/);
    }
    assert.ok(calls.prompts.length <= 2, "Unmet requirements have a bounded repair opportunity");
    assert.equal(calls.sessions[0], scenario === "follow-up" ? "old-session" : undefined);
    assert.equal(calls.prompts[0].includes("This is a follow-up"), scenario.startsWith("follow-up"));
    if (scenario === "security-latest") {
      assert.equal(events.at(-1)?.tests?.total, 3);
      assert.equal(events.at(-1)?.compile?.solc, "fixture-2");
      assert.equal(events.at(-1)?.analysis?.version, "fixture-2");
      assert.match(events.at(-1)?.text ?? "", /3 of 3 tests passed/);
      assert.equal(events.filter((event) => event.tests).at(-1)?.tests?.total, 3);
    }
    if (scenario === "deploy-failed") {
      assert.equal(calls.web, 1);
      assert.equal(events.at(-1)?.text, "The contract could not be deployed. Your files are saved.");
      assert.ok(events.some((event) => event.phase === "deploying" && event.text === "Not deployed: Controlled deploy failure"));
    }
    if (["deploy-failed", "web-failed", "publish-failed", "verify-failed-publish-failed", "read-only-web-failed", "read-only-publish-failed"].includes(scenario)) {
      assert.match(events.at(-1)?.text ?? "", /Your files are saved/);
      assert.doesNotMatch(events.at(-1)?.text ?? "", /existing published app/);
    }
    if (readOnly && successful) {
      assert.match(events.at(-1)?.text ?? "", /Frontend built/);
      assert.doesNotMatch(events.at(-1)?.text ?? "", /reads the chain|none was needed/);
      assert.equal(calls.deploy, 0);
      assert.equal(calls.publish, 1);
    }
    if (compilerRepair || forbiddenWallet) {
      assert.equal(calls.prompts.length, 2, "The final verdict guard does not schedule another repair");
      assert.equal(calls.deploy, 0);
      assert.equal(calls.web, 0);
      assert.equal(calls.publish, 0);
      assert.match(events.at(-1)?.text ?? "", /for an app/);
    }
    if (scenario.endsWith("web-failed")) {
      assert.equal(calls.publish, 0);
      assert.equal(calls.deploy, 0, "Broken frontend must never deploy");
      assert.equal(calls.prompts.length, 2, "Frontend repair is bounded to one turn");
    }
    if (["missing-tests", "zero-tests", "failing-tests", "analysis-unavailable", "security-deletes-tests"].includes(scenario)) {
      assert.equal(calls.web, 0, "Unproven contracts cannot advance to frontend packaging");
    }
    if (scenario.startsWith("frontend-")) {
      assert.match(calls.prompts[1], /Controlled frontend failure/);
      assert.equal(calls.prompts.length, 2);
      assert.equal(calls.deploy, scenario === "frontend-repaired" ? 1 : 0);
      assert.equal(calls.publish, scenario === "frontend-repaired" ? 1 : 0);
      if (scenario === "frontend-repaired") {
        assert.equal(calls.tests, 2, "Contract tests pass before frontend packaging and rerun after its repair");
        assert.equal(calls.analysis, 2, "Security checks pass before frontend packaging and rerun after its repair");
      }
    }
    if (!successful && !["deploy-failed", "web-failed", "publish-failed", "verify-failed-publish-failed", "read-only-web-failed", "read-only-publish-failed"].includes(scenario)) assert.equal(calls.deploy, 0);
    assert.equal(await readFile(join(workspace, "brief", "launchpad.md"), "utf8"), attachedText);
  });
}
