import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import type { CliBuilderOptions } from "@/lib/build/cli-builder";
import type { BuildEvent, Builder, CompileReport } from "@/lib/build/types";

const MOCK_MODULES: Record<string, string> = {
  "@/lib/agent/cli-runner": "export const runAgentCli = fixture.runAgentCli;",
  "@/lib/agent/needs-analysis": "export const analyseNeeds = fixture.analyseNeeds; export async function needsViolations() { return []; }",
  "@/lib/agent/chain-facts": `
    export function withBuildFacts(prompt) { return prompt; }
    export function agentTaskPrompt(prompt) { return prompt; }
    export function followUpPrompt(prompt) { return prompt; }
    export function repairPrompt() { return 'COMPILER_REPAIR'; }
    export function securityRepairPrompt() { return 'SECURITY_REPAIR'; }
  `,
  "@/lib/build/write-attachments": "export async function writeAttachments() { return []; }",
  "@/lib/build/foundry": "export const compile = fixture.compile; export const runTests = fixture.runTests; export async function writeFoundryConfig() {}",
  "@/lib/build/analysis": "export const analyseContracts = fixture.analyseContracts;",
  "@/lib/build/deploy": "export const deployToTestnet = fixture.deployToTestnet;",
  "@/lib/build/verify": "export const verifyOnBlockscout = fixture.verifyOnBlockscout;",
  "@/lib/build/web": "export const buildWebApp = fixture.buildWebApp; export async function hasFrontEnd() { return true; } export async function sandboxTemplateVersion() { return 'controlled-fixture'; }",
  "@/lib/hosting/drafts": "export const prepareSiteDraft = fixture.prepareSiteDraft;",
  "@/lib/hosting/publish": "export const publishSite = fixture.publishSite;",
  "@/lib/build/workspace-files": "export async function listWorkspaceArtifacts() { return []; }",
  "@/lib/build/workspace": "export async function directoryBytes() { return 0; } export function workspaceMaxBytes() { return 67108864; }",
  "@/lib/chain/rpc": "export const PUBLIC_RPC_URLS = { 46630: 'https://rpc.fixture.invalid' };",
  "@/lib/chain/explorer": "export function explorerBaseUrl() { return 'https://explorer.fixture.invalid'; }",
  "@/lib/config": "export const RH_TESTNET_ID = 46630;",
};

async function bundleBuilder(): Promise<string> {
  const result = await build({
    stdin: { contents: 'export { CliBuilder } from "@/lib/build/cli-builder";', resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    define: { "process.env.FORGE_AGENT_REPAIR_ROUNDS": '"1"' },
    plugins: [{ name: "no-model-chain-or-toolchain", setup(plugin) {
      plugin.onResolve({ filter: /^@\// }, function controlledDependency(args) {
        if (Object.hasOwn(MOCK_MODULES, args.path)) return { path: args.path, namespace: "fixture" };
      });
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, function mockModule(args) {
        return { contents: MOCK_MODULES[args.path], loader: "js" };
      });
    } }],
  });
  return result.outputFiles[0].text;
}

const bundled = bundleBuilder();
const READ_ONLY_PAGE = "export default function App() { return <main>Read-only chain data</main>; }";

async function writePage(workspace: string, wallet: boolean): Promise<void> {
  await mkdir(join(workspace, "src"), { recursive: true });
  const content = wallet
    ? 'import { WalletProvider, WalletControl } from "../fletch/wallet"; export default function App() { return <WalletProvider><WalletControl /></WalletProvider>; }'
    : 'import { createConfig } from "wagmi"; import { walletConnect } from "wagmi/connectors"; const config = createConfig({ connectors: [walletConnect({ projectId: "synthetic-fixture" })] }); export default function App() { return <button>WalletConnect only</button>; }';
  await writeFile(join(workspace, "src", "main.tsx"), content);
}

async function installFoundation(workspace: string): Promise<void> {
  await mkdir(join(workspace, "fletch"), { recursive: true });
  for (const file of ["wallet.tsx", "wallet-connectors.ts"]) {
    await copyFile(join(process.cwd(), "docker/webapp-template/foundation", file), join(workspace, "fletch", file));
  }
  await writePage(workspace, true);
}

for (const scenario of ["repair", "still-missing", "compiler-removal", "security-removal", "read-only", "manual-contract", "manual-read-only"] as const) {
  test(`actual CliBuilder wallet publication: ${scenario}`, async function publication(t) {
    const root = await mkdtemp(join(tmpdir(), "fletch-wallet-publication-"));
    t.after(async function cleanup() { await rm(root, { recursive: true, force: true }); });
    const calls = { prompts: [] as string[], compile: 0, tests: 0, analysis: 0, deploy: 0, verify: 0, web: 0, publish: 0, draft: 0 };
    const wallet = scenario !== "read-only" && scenario !== "manual-read-only";
    const manual = scenario.startsWith("manual-");
    const fixture = {
      async analyseNeeds() { return { verdict: { contract: wallet, wallet, reason: "Controlled orchestration fixture", source: "model" } }; },
      async *runAgentCli({ workspace, prompt }: { workspace: string; prompt: string }) {
        calls.prompts.push(prompt);
        const turn = calls.prompts.length;
        if (turn === 1) {
          if (wallet) {
            await mkdir(join(workspace, "contracts"), { recursive: true });
            await writeFile(join(workspace, "contracts", "Example.sol"), "contract Example {}");
          }
          if (scenario === "compiler-removal" || scenario === "security-removal" || scenario === "manual-contract") await installFoundation(workspace);
          else {
            await writePage(workspace, false);
            if (!wallet) await writeFile(join(workspace, "src/main.tsx"), READ_ONLY_PAGE);
          }
        } else if (scenario === "repair") {
          await installFoundation(workspace);
        } else {
          await writePage(workspace, false);
        }
        yield { kind: "result", text: "Controlled model completion; no provider called." };
      },
      async compile(): Promise<CompileReport> {
        calls.compile++;
        const ok = scenario !== "compiler-removal" || calls.compile > 1;
        return { ok, solc: "fixture", contracts: wallet ? [{ name: "Example", source: "contracts/Example.sol", bytecodeBytes: 1, functions: 0, events: 0, abi: [] }] : [], errors: ok ? [] : [{ severity: "error", message: "Controlled compiler failure" }], warnings: 0, durationMs: 0 };
      },
      async runTests() { calls.tests++; return { total: 1, passed: 1, failed: 0, cases: [], durationMs: 0 }; },
      async analyseContracts() {
        calls.analysis++;
        const blocking = scenario === "security-removal" && calls.analysis === 1 ? 1 : 0;
        return { ran: true, skipped: null, blocking, findings: blocking ? [{ impact: "High", description: "Controlled finding" }] : [] };
      },
      async deployToTestnet() {
        calls.deploy++;
        return { ok: true, address: "0x0000000000000000000000000000000000000001", contractName: "Example", abi: [] };
      },
      async verifyOnBlockscout() { calls.verify++; return { ok: true }; },
      async buildWebApp() { calls.web++; return { ok: true, bytes: 1, files: 1, templateVersion: "controlled-fixture" }; },
      async prepareSiteDraft() { calls.draft++; return {}; },
      async publishSite() { calls.publish++; return { ok: true, url: "https://published.fixture.invalid" }; },
    };
    const compiled = { exports: {} as { CliBuilder: new (options: CliBuilderOptions) => Builder } };
    // Only trusted repository orchestration executes. Fixture app files are parsed,
    // never imported; model, compiler, security, deployment and hosting are mocked.
    new Function("require", "module", "exports", "fixture", await bundled)(createRequire(join(process.cwd(), "package.json")), compiled, compiled.exports, fixture);
    const builder = new compiled.exports.CliBuilder({ workspaceRoot: root, manualPublish: manual, provider: { id: "kimi", baseUrl: "https://provider.fixture.invalid", apiKey: "", model: "fixture", inputPerMTok: 0, outputPerMTok: 0, bringYourOwnKey: true } });
    const events: BuildEvent[] = [];
    for await (const event of builder.run({ buildId: `fixture-${scenario}`, slug: "owned-fixture", prompt: "Build the controlled fixture", ownerAddress: null })) events.push(event);
    const workspace = join(root, "owned-fixture");
    const last = events.at(-1);
    if (scenario === "repair" || scenario === "read-only" || manual) {
      assert.equal(last?.phase, "done");
      assert.equal(last?.previewUrl, manual ? undefined : "https://published.fixture.invalid");
      assert.equal(last?.draftReady, manual ? true : undefined);
      assert.equal(calls.draft, manual ? 1 : 0);
      if (manual) assert.match(last?.text ?? "", /Publish live app/);
      assert.equal(calls.web, 2);
      assert.equal(calls.publish, manual ? 0 : 1);
      assert.equal(calls.deploy, wallet ? 1 : 0);
      assert.equal(calls.prompts.length, scenario === "repair" ? 2 : 1);
      assert.equal(calls.compile, 1);
      if (!wallet) assert.equal(await readFile(join(workspace, "src/main.tsx"), "utf8"), READ_ONLY_PAGE);
      if (scenario === "repair") {
        assert.match(calls.prompts[1], /Use WalletProvider and one WalletControl/);
        assert.equal(await readFile(join(workspace, "fletch/wallet.tsx"), "utf8"), await readFile("docker/webapp-template/foundation/wallet.tsx", "utf8"));
      }
    } else {
      assert.equal(last?.phase, "error");
      assert.match(last?.text ?? "", /Required shared wallet integration missing after repair/);
      assert.equal(calls.prompts.length, 2, "no extra wallet or toolchain retry is invented");
      assert.equal(calls.deploy, 0);
      assert.equal(calls.verify, 0);
      assert.equal(calls.web, 0);
      assert.equal(calls.publish, 0);
      assert.equal(events.some((event) => event.phase === "done"), false);
      assert.match(await readFile(join(workspace, "src/main.tsx"), "utf8"), /WalletConnect only/, "failed generated source remains available");
      if (scenario === "still-missing") {
        assert.equal(calls.compile, 0);
        assert.equal(calls.tests, 0);
        assert.equal(calls.analysis, 0);
      } else {
        assert.equal(calls.compile, 2);
        assert.equal(calls.prompts[1], scenario === "compiler-removal" ? "COMPILER_REPAIR" : "SECURITY_REPAIR");
      }
    }
  });
}
