import { workerOperation } from "@/lib/build/durable/execution";
import { spawn } from "node:child_process";
import { checkBuildCancellation } from "@/lib/build/cancellation";
import { prepareBuildProcess, watchBuildProcess } from "@/lib/build/process-cancellation";
import { artifactContractIdentity } from "@/lib/build/deployment-target";
import { ToolOutput } from "./tool-output";
import "server-only";
import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSandboxImage, sandboxArgs } from "@/lib/agent/sandbox";
import type {
  CompileReport,
  ContractSummary,
  Diagnostic,
  TestCase,
  TestReport,
} from "@/lib/build/types";

// Fletch compiles and tests the agent's output itself, in the same locked-down
// container, instead of believing the model when it says the code works. What the
// user sees is solc's verdict, not the agent's summary of it.

// Pinned to the compiler pre-warmed into the image, so a build never downloads a
// toolchain mid-request. The server owns this file — leaving it to the model meant
// a different solc per build and a network fetch to match.
export const SOLC_VERSION = "0.8.28";
const FOUNDRY_CONFIG = `[profile.default]
src = "contracts"
test = "test"
out = "out"
solc = "${SOLC_VERSION}"
optimizer = true
optimizer_runs = 200
# Explicit, not merely defaulted: ffi would turn the server's own verification run
# into a shell for whatever the agent wrote.
ffi = false
remappings = ["forge-std/=/opt/forge-std/src/"]
`;

const FORGE_TIMEOUT_MS = 180_000;

export async function writeFoundryConfig(workspace: string): Promise<void> {
  checkBuildCancellation();
  await writeFile(join(workspace, "foundry.toml"), FOUNDRY_CONFIG);
}

export interface ForgeRun {
  code: number;
  stdout: string;
  stderr: string;
}

// Exported for lib/build/verify.ts, which needs forge to emit the standard JSON
// input inside the image, where the forge-std remapping resolves.
export function runForge(workspace: string, args: string[]): Promise<ForgeRun> {
  return runTool(workspace, ["forge", ...args]);
}

// forge includes dependency ABIs and metadata in its JSON output; a normal
// forge-std build can exceed 90 MiB. Keep that document inside the memory-limited
// sandbox and return only the diagnostics this caller reads. Isolated Python
// imports cannot load agent-written modules from the workspace.
const COMPILE_DIAGNOSTICS = `import json, subprocess, sys
result = subprocess.run(["forge", "build", "--force", "--json", "--build-info"], stdout=subprocess.PIPE)
try:
    document = json.loads(result.stdout[result.stdout.index(b"{"):])
    diagnostics = {"errors": document.get("errors", [])}
except (ValueError, AttributeError):
    sys.stdout.buffer.write(result.stdout)
else:
    sys.stdout.write(json.dumps(diagnostics))
sys.exit(result.returncode if result.returncode >= 0 else 128 - result.returncode)
`;

export function runCompiler(workspace: string): Promise<ForgeRun> {
  return runTool(workspace, ["python3", "-I", "-c", COMPILE_DIAGNOSTICS]);
}

// Any toolchain command in the sandbox over the workspace: forge, and the
// static analyser. Without an image (local development) the command runs on
// the host, which only works for tools installed there.
export async function runTool(workspace: string, tool: string[]): Promise<ForgeRun> {
  checkBuildCancellation();
  const image = requireSandboxImage();
  const name = `fletch-tool-${randomUUID().slice(0, 8)}`;
  const command = image ? "docker" : tool[0];
  const commandArgs = image ? sandboxArgs({ image, workspace, name, network: "none" }, tool) : tool.slice(1);

  const prepared = await prepareBuildProcess(command, commandArgs, { cwd: workspace }, image ? name : undefined);
  return new Promise(function execute(resolve, reject) {
    const child = spawn(command, prepared, { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
    const cancellation = watchBuildProcess(child, image ? name : undefined);
    const output = new ToolOutput();
    const timer = setTimeout(function onTimeout() {
      cancellation.stop();
    }, FORGE_TIMEOUT_MS);

    child.stdout.on("data", function onOut(chunk: Buffer) {
      output.append("stdout", chunk);
      if (output.exceeded) cancellation.stop();
    });
    child.stderr.on("data", function onErr(chunk: Buffer) {
      output.append("stderr", chunk);
      if (output.exceeded) cancellation.stop();
    });
    child.on("error", function onSpawnError(cause: Error) {
      clearTimeout(timer);
      void cancellation.dispose().then(() => resolve({ code: 1, stdout: "", stderr: cause.message }), reject);
    });
    child.on("close", function onClose(code) {
      clearTimeout(timer);
      void cancellation.dispose().then(function finished() {
        checkBuildCancellation();
        if (output.exceeded) {
          resolve({ code: 1, stdout: "", stderr: "The tool exceeded the 16 MiB output limit and was stopped. Saved source is retained." });
          return;
        }
        resolve({ code: code ?? 1, stdout: output.read("stdout"), stderr: output.read("stderr") });
      }).catch(reject);
    });
  });
}

// forge prints progress lines before the JSON document; take the object.
function extractJson(text: string): unknown {
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

interface RawDiagnostic {
  severity?: string;
  message?: string;
  formattedMessage?: string;
  sourceLocation?: { file?: string };
}

function toDiagnostics(raw: unknown): Diagnostic[] {
  const errors = (raw as { errors?: RawDiagnostic[] })?.errors ?? [];
  return errors.map(function normalise(entry): Diagnostic {
    return {
      severity: entry.severity === "warning" ? "warning" : "error",
      message: (entry.message ?? "Compilation failed").trim(),
      file: entry.sourceLocation?.file,
    };
  });
}

function hexBytes(object: string | undefined): number {
  if (!object) {
    return 0;
  }
  const hex = object.startsWith("0x") ? object.slice(2) : object;
  return Math.floor(hex.length / 2);
}

interface ForgeArtifact {
  abi?: Array<{ type?: string; name?: string }>;
  bytecode?: { object?: string };
  deployedBytecode?: { object?: string };
}

// Walks out/<Source>.sol/<Contract>.json, keeping only contracts the user's own
// sources produced — forge-std and the test suite also land in out/.
async function readContracts(workspace: string, sourceFiles: string[]): Promise<ContractSummary[]> {
  const outDir = join(workspace, "out");
  const sources = new Set(
    sourceFiles.map(function basename(path) {
      return path.split("/").pop() as string;
    }),
  );
  const dirs = await readdir(outDir, { withFileTypes: true }).catch(function ignore() {
    return [];
  });
  const summaries: ContractSummary[] = [];

  for (const dir of dirs) {
    if (!dir.isDirectory() || !sources.has(dir.name)) {
      continue;
    }
    const files = await readdir(join(outDir, dir.name), { withFileTypes: true }).catch(function ignore() {
      return [];
    });
    for (const entry of files) {
      // Read on the host: a symlink the agent planted here would be followed with
      // the server's privileges, so only regular files are opened.
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }
      const file = entry.name;
      const text = await readFile(join(outDir, dir.name, file), "utf8").catch(function ignore() {
        return "";
      });
      if (!text) {
        continue;
      }
      let artifact: ForgeArtifact;
      try {
        artifact = JSON.parse(text) as ForgeArtifact;
      } catch {
        continue;
      }
      const identity = artifactContractIdentity(artifact);
      if (!identity || identity.contract !== file.replace(/\.json$/, "")) continue;
      const abi = artifact.abi ?? [];
      summaries.push({
        name: identity.contract,
        source: identity.source,
        // Deployed (runtime) size is what EIP-170 caps, not the creation code.
        bytecodeBytes: hexBytes(artifact.deployedBytecode?.object ?? artifact.bytecode?.object),
        functions: abi.filter(function isFunction(entry) {
          return entry.type === "function";
        }).length,
        events: abi.filter(function isEvent(entry) {
          return entry.type === "event";
        }).length,
        abi,
      });
    }
  }
  return summaries;
}

async function compileInternal(workspace: string, sourceFiles: string[]): Promise<CompileReport> {
  const startedAt = Date.now();
  // The agent can write anywhere in the workspace, including over foundry.toml —
  // and `ffi = true` there would turn our own verification run into arbitrary
  // command execution. The server's config is rewritten immediately before every
  // run so whatever the agent left is discarded.
  await writeFoundryConfig(workspace);
  // --build-info writes the compiler's standard JSON input to out/build-info,
  // which is what Blockscout verification submits (lib/build/verify.ts). forge
  // can only regenerate it with network access, and the build sandbox has none.
  // A repair may remove a contract while keeping its source filename. Rebuild
  // regenerable artifacts in the sandbox so old bytecode cannot pass this gate.
  const run = await runCompiler(workspace);
  const parsed = extractJson(run.stdout);
  const diagnostics = toDiagnostics(parsed);
  const errors = diagnostics.filter(function isError(entry) {
    return entry.severity === "error";
  });

  // A crash with no parseable JSON is still a failure the user must see.
  if (!parsed && run.code !== 0) {
    errors.push({
      severity: "error",
      message: (run.stderr || run.stdout).trim().split("\n").pop() ?? "The compiler could not run.",
    });
  }

  const ok = run.code === 0 && errors.length === 0;
  return {
    ok,
    solc: SOLC_VERSION,
    contracts: ok ? await readContracts(workspace, sourceFiles) : [],
    errors: errors.slice(0, 6),
    warnings: diagnostics.length - errors.length,
    durationMs: Date.now() - startedAt,
  };
}

interface RawTestResult {
  status?: string;
  reason?: string | null;
  kind?: { Unit?: { gas?: number } };
}

interface RawSuite {
  test_results?: Record<string, RawTestResult>;
}

async function hasFoundryTests(directory: string): Promise<boolean> {
  checkBuildCancellation();
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isFile() && entry.name.endsWith(".t.sol")) return true;
    if (entry.isDirectory() && await hasFoundryTests(join(directory, entry.name))) return true;
  }
  return false;
}

async function runTestsInternal(workspace: string): Promise<TestReport | null> {
  if (!(await hasFoundryTests(join(workspace, "test")))) {
    return null;
  }

  const startedAt = Date.now();
  await writeFoundryConfig(workspace);
  const run = await runForge(workspace, ["test", "--json"]);
  const parsed = extractJson(run.stdout) as Record<string, RawSuite> | null;
  if (!parsed) {
    // Tests exist but forge produced no verdict (a timeout, a crash, a compile
    // error in the tests): that is a failed run, never "no tests".
    const reason = (run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300) || "forge test produced no result";
    return {
      exitCode: run.code,
      total: 1,
      passed: 0,
      failed: 1,
      cases: [{ name: "forge test", suite: "toolchain", passed: false, gas: null, reason }],
      durationMs: Date.now() - startedAt,
    };
  }

  const cases: TestCase[] = [];
  for (const [suiteKey, suite] of Object.entries(parsed)) {
    const suiteName = suiteKey.split(":").pop() ?? suiteKey;
    for (const [name, result] of Object.entries(suite.test_results ?? {})) {
      cases.push({
        name: name.replace(/\(\)$/, ""),
        suite: suiteName,
        passed: result.status === "Success",
        gas: result.kind?.Unit?.gas ?? null,
        reason: result.reason ?? undefined,
      });
    }
  }

  const passed = cases.filter(function isPass(entry) {
    return entry.passed;
  }).length;
  return {
    exitCode: run.code,
    total: cases.length,
    passed,
    failed: cases.length - passed,
    cases: cases.slice(0, 24),
    durationMs: Date.now() - startedAt,
  };
}

export async function compile(workspace: string, sourceFiles: string[]): Promise<CompileReport> {
  return workerOperation("compile", "tool", () => compileInternal(workspace, sourceFiles));
}

export async function runTests(workspace: string): Promise<TestReport | null> {
  return workerOperation("tests", "tool", () => runTestsInternal(workspace));
}
