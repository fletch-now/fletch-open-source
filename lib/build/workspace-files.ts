import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import type { ArtifactKind, BuildArtifact } from "@/lib/build/types";

// Reading a project's workspace back on the host. Two callers: the builder, which
// reports what a run wrote, and the build page, which shows a reopened project's
// files. Everything here runs with the server's privileges over files the agent
// wrote, so no symlink is ever followed and every path is confined to the
// workspace's real directory.

const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "cache", "lib", "broadcast", ".agent-home"]);
// The server writes foundry.toml and vite.config.mts itself; they are not the
// agent's work and the panel shows what the agent wrote.
const SKIP_FILES = new Set(["agent-stream.log", "foundry.toml", "vite.config.mts"]);
const MAX_PREVIEW_LINES = 14;
const MAX_ARTIFACT_BYTES = 200_000;

export interface WorkspaceReadBudget {
  entries: number;
  bytes: number;
}

function kindFor(path: string): ArtifactKind {
  if (path.endsWith(".sol")) {
    return "contract";
  }
  if (path.endsWith(".json") || path.endsWith(".toml") || path.endsWith(".config.ts")) {
    return "config";
  }
  return "app";
}

async function listFiles(root: string, dir: string, budget?: WorkspaceReadBudget, depth = 0): Promise<string[]> {
  if (budget && depth > 16) throw new Error("The workspace exceeds the live file viewer's depth limit.");
  const entries = await readdir(dir, { withFileTypes: true }).catch(function ignore() {
    return [];
  });
  const found: string[] = [];
  for (const entry of entries) {
    if (budget && --budget.entries < 0) throw new Error("The workspace has too many entries for live file updates.");
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) {
      continue;
    }
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await listFiles(root, full, budget, depth + 1)));
    } else {
      found.push(relative(root, full));
    }
  }
  return found;
}

// A relative path the panel may ask for: no absolute paths, no traversal, no
// hidden segments. The realpath check below is the second line.
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.length > 400 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  return path.split("/").every(function segment(part) {
    return part.length > 0 && part !== "." && part !== ".." && !part.startsWith(".");
  });
}

// The file's text, or null when it is missing, too large, a link, or resolves
// outside the workspace.
export async function readWorkspaceFile(workspace: string, path: string, maxBytes = MAX_ARTIFACT_BYTES): Promise<string | null> {
  if (!isSafeRelativePath(path)) {
    return null;
  }
  const full = join(workspace, path);
  const info = await lstat(full).catch(function ignore() {
    return null;
  });
  if (!info?.isFile() || info.size > maxBytes) {
    return null;
  }
  const root = await realpath(workspace).catch(function ignore() {
    return workspace;
  });
  const resolved = await realpath(full).catch(function ignore() {
    return null;
  });
  if (!resolved || (resolved !== root && !resolved.startsWith(resolve(root) + sep))) {
    return null;
  }
  return readFile(full, "utf8").catch(function ignore() {
    return null;
  });
}

// Every file the agent left in the workspace, with a short preview each, in
// walk order. The full text is fetched on demand through readWorkspaceFile.
export async function listWorkspaceArtifacts(workspace: string, budget?: WorkspaceReadBudget): Promise<BuildArtifact[]> {
  const artifacts: BuildArtifact[] = [];
  const seen = new Set<string>();
  for (const path of await listFiles(workspace, workspace, budget)) {
    if (seen.has(path)) {
      continue;
    }
    seen.add(path);
    if (/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|pdf)$/i.test(path)) {
      continue;
    }
    const content = await readWorkspaceFile(workspace, path);
    if (!content) {
      continue;
    }
    if (budget && (budget.bytes -= Buffer.byteLength(content)) < 0) throw new Error("The workspace is too large for live file updates.");
    const lines = content.split("\n");
    artifacts.push({
      path,
      kind: kindFor(path),
      lines: lines.length,
      preview: lines.slice(0, MAX_PREVIEW_LINES).join("\n"),
      contentHash: createHash("sha256").update(content).digest("hex"),
    });
  }
  return artifacts;
}
