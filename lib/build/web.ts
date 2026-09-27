import { workerOperation } from "@/lib/build/durable/execution";
import { ToolOutput } from "./tool-output";
import { checkBuildCancellation } from "@/lib/build/cancellation";
import { prepareBuildProcess, watchBuildProcess } from "@/lib/build/process-cancellation";
import "server-only";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { requireSandboxImage, sandboxArgs } from "@/lib/agent/sandbox";

// Builds the front end the agent wrote into static files, in the same locked-down
// container as the compiler, with no network: the dependency set is baked into the
// image at /opt/webapp and linked in. The server owns the Vite config, so the
// agent cannot point the build anywhere else or add a plugin.

const WEB_BUILD_TIMEOUT_MS = 180_000;
// A page for a token is a few hundred kilobytes; ten megabytes is an agent
// bundling something it should not have, or a prompt trying to fill the disk.
const MAX_DIST_BYTES = 10 * 1024 * 1024;
const TEMPLATE_MODULES = "/opt/webapp/node_modules";

export async function sandboxTemplateVersion(): Promise<string | null> {
  checkBuildCancellation();
  const image = requireSandboxImage();
  if (!image) return null;
  return new Promise(function inspect(resolve, reject) {
    const child = spawn("docker", ["image", "inspect", "--format", '{{ index .Config.Labels "io.fletch.webapp-template" }}', image], { stdio: ["ignore", "pipe", "ignore"] });
    const cancellation = watchBuildProcess(child);
    let output = "";
    const timer = setTimeout(cancellation.stop, 10_000);
    child.stdout.on("data", function read(chunk: Buffer) { output += chunk.toString(); });
    child.on("error", function unavailable() { clearTimeout(timer); void cancellation.dispose().then(() => resolve(null), reject); });
    child.on("close", function complete(code) {
      clearTimeout(timer);
      const version = output.trim();
      void cancellation.dispose().then(function inspected() {
        checkBuildCancellation();
        resolve(code === 0 && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version) ? version : null);
      }).catch(reject);
    });
  });
}

// Written fresh before every build, so whatever the agent left under this name is
// discarded. `base: "./"` keeps the bundle relocatable; the site is served from
// the root of its own host, so either works, and relative is safer if that changes.
const VITE_CONFIG = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false, target: "es2020" },
  logLevel: "warn",
});
`;

export interface WebBuildEnv {
  contractAddress?: string;
  chainId: number;
  rpcUrl: string;
  explorerUrl: string;
  // Lets the page offer WalletConnect when the platform has a project id.
  walletConnectProjectId?: string;
}

export type WebBuildResult =
  | { ok: true; bytes: number; files: number; templateVersion: string | null }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; skipped: false; error: string };

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    function found() {
      return true;
    },
    function missing() {
      return false;
    },
  );
}

// The agent writes index.html at the root; without it there is no page to build.
export async function hasFrontEnd(workspace: string): Promise<boolean> {
  return exists(join(workspace, "index.html"));
}

// Vite reads VITE_* from .env.production at the project root. The agent is told
// to read these names; the deployed address is what turns a template into the
// page for this contract.
function envFile(env: WebBuildEnv): string {
  return [
    `VITE_CONTRACT_ADDRESS=${env.contractAddress ?? ""}`,
    `VITE_CHAIN_ID=${env.chainId}`,
    `VITE_RPC_URL=${env.rpcUrl}`,
    `VITE_EXPLORER_URL=${env.explorerUrl}`,
    `VITE_WALLETCONNECT_PROJECT_ID=${env.walletConnectProjectId ?? ""}`,
    "",
  ].join("\n");
}

interface Run {
  code: number;
  output: string;
}

async function runVite(workspace: string): Promise<Run> {
  checkBuildCancellation();
  const image = requireSandboxImage();
  const name = `fletch-web-${randomUUID().slice(0, 8)}`;
  const vite = `${TEMPLATE_MODULES}/.bin/vite`;
  const command = image ? "docker" : vite;
  const args = image
    ? sandboxArgs({ image, workspace, name, network: "none" }, ["sh", "-c", `if [ -f /opt/webapp/build.mjs ]; then exec node /opt/webapp/build.mjs; fi; exec ${vite} build --config vite.config.mts`])
    : ["build", "--config", "vite.config.mts"];
  const prepared = await prepareBuildProcess(command, args, { cwd: workspace }, image ? name : undefined);
  return new Promise(function execute(resolve, reject) {
    const child = spawn(command, prepared, { cwd: workspace, stdio: ["ignore", "pipe", "pipe"] });
    const cancellation = watchBuildProcess(child, image ? name : undefined);
    const output = new ToolOutput();
    const timer = setTimeout(function onTimeout() {
      cancellation.stop();
    }, WEB_BUILD_TIMEOUT_MS);
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
      void cancellation.dispose().then(() => resolve({ code: 1, output: cause.message }), reject);
    });
    child.on("close", function onClose(code) {
      clearTimeout(timer);
      void cancellation.dispose().then(function finished() {
        checkBuildCancellation();
        if (output.exceeded) {
          resolve({ code: 1, output: "The front-end build exceeded the 16 MiB output limit and was stopped. Saved source is retained." });
          return;
        }
        resolve({ code: code ?? 1, output: output.read("stdout") + "\n" + output.read("stderr") });
      }).catch(reject);
    });
  });
}

// Total bytes of regular files under dist; a symlink anywhere fails the build,
// because the publish step copies with the server's privileges.
async function measureDist(dir: string): Promise<{ bytes: number; files: number } | null> {
  let bytes = 0;
  let files = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      return null;
    }
    if (entry.isDirectory()) {
      const inner = await measureDist(full);
      if (!inner) {
        return null;
      }
      bytes += inner.bytes;
      files += inner.files;
    } else if (entry.isFile()) {
      bytes += (await stat(full)).size;
      files += 1;
    }
  }
  return { bytes, files };
}

// Vite prints "x Build failed in 1.2s", then "error during build:", then the
// line that says what went wrong; the stack trace follows. That third line is
// the one a person can act on, so it is what the build log shows.
function firstUsefulLine(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^x Build failed|^error during build:?$|^\s*at /.test(line));
  const useful = lines.find((line) => /error|could not|cannot|not exported|not found|unexpected|failed to resolve/i.test(line)) ?? lines[0];
  return (useful ?? "vite build failed").replace(/\/work\//g, "").replace(/\.\.\/opt\/webapp\//g, "").slice(0, 300);
}

async function buildWebAppInternal(workspace: string, env: WebBuildEnv): Promise<WebBuildResult> {
  checkBuildCancellation();
  if (!(await hasFrontEnd(workspace))) {
    return { ok: false, skipped: true, reason: "The agent wrote no index.html, so there is no page to host." };
  }
  await writeFile(join(workspace, "vite.config.mts"), VITE_CONFIG);
  await writeFile(join(workspace, ".env.production"), envFile(env));
  // A symlink inside the mount resolves inside the container, where the target
  // exists; on the host it dangles, and the workspace walkers skip it.
  const modules = join(workspace, "node_modules");
  if (!(await exists(modules))) {
    await symlink(TEMPLATE_MODULES, modules);
  }
  checkBuildCancellation();
  await rm(join(workspace, "dist"), { recursive: true, force: true });

  const run = await runVite(workspace);
  if (run.code !== 0) {
    return { ok: false, skipped: false, error: firstUsefulLine(run.output) };
  }
  const dist = join(workspace, "dist");
  if (!(await exists(join(dist, "index.html")))) {
    return { ok: false, skipped: false, error: "vite build produced no index.html" };
  }
  const size = await measureDist(dist);
  if (!size) {
    return { ok: false, skipped: false, error: "The build output contained a symbolic link, which is not allowed." };
  }
  if (size.bytes > MAX_DIST_BYTES) {
    return { ok: false, skipped: false, error: `The built site is ${(size.bytes / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.` };
  }
  const templateVersion = /^FLETCH_TEMPLATE_VERSION=([0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?)$/m.exec(run.output)?.[1] ?? null;
  checkBuildCancellation();
  return { ok: true, bytes: size.bytes, files: size.files, templateVersion };
}

export async function buildWebApp(workspace: string, env: WebBuildEnv): Promise<WebBuildResult> {
  return workerOperation("frontend", "tool", () => buildWebAppInternal(workspace, env));
}
