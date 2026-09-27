import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { openSourceFile } from "@/lib/source-file";

interface SourceFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SourceManifest {
  version: 1;
  buildId: string;
  attempt: number;
  stage: string;
  continuation: "unavailable";
  files: SourceFile[];
}

export interface SourceCheckpoint {
  hash: string;
  path: string;
  manifest: SourceManifest;
}

export interface CheckpointOptions {
  workspace: string;
  archiveRoot: string;
  buildId: string;
  attempt: number;
  stage: string;
  maxBytes?: number;
  // The platform adapter must prove that no sandbox process can write here.
  // A lease alone does not make copying a live workspace an atomic snapshot.
  assertQuiescent: () => Promise<void>;
}

const OMIT_DIRECTORIES = new Set(["node_modules", ".git", "out", "dist", "cache", "broadcast", ".agent-home"]);

function hashBytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function beneath(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

function safePath(path: string): boolean {
  return Boolean(path) && !path.includes("\\") && !path.includes("\0")
    && path.split("/").every(function segment(part) { return Boolean(part) && part !== "." && part !== ".."; });
}

async function sourcePaths(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    if (OMIT_DIRECTORIES.has(entry.name) || entry.name === ".env" || entry.name.startsWith(".env.") || entry.name === "agent-stream.log") continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Checkpoint rejected a source symlink.");
    if (entry.isDirectory()) paths.push(...await sourcePaths(root, path));
    else if (entry.isFile()) paths.push(relative(root, path).split(sep).join("/"));
    else throw new Error("Checkpoint accepts only regular source files.");
  }
  return paths.sort();
}

async function readSource(root: string, path: string, maxBytes: number): Promise<Buffer> {
  if (!safePath(path)) throw new Error("Invalid checkpoint source path.");
  const full = join(root, path);
  const canonical = await realpath(full);
  if (!beneath(root, canonical) || canonical !== full) throw new Error("Checkpoint source must not follow symlinks.");
  const handle = await openSourceFile(full);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maxBytes || before.nlink !== 1) throw new Error("Checkpoint source is unsafe or exceeds its byte limit.");
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length > maxBytes || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
      throw new Error("Source changed while creating a checkpoint.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncTreeDirectories(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory()) await syncTreeDirectories(join(path, entry.name));
  }
  await syncDirectory(path);
}

async function durableWrite(path: string, bytes: Buffer | string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, 0o400);
  await syncDirectory(dirname(path));
}

export async function createSourceCheckpoint(options: CheckpointOptions): Promise<SourceCheckpoint> {
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isInteger(options.attempt) || options.attempt < 1) {
    throw new Error("Checkpoint requires a positive byte limit and attempt.");
  }
  await options.assertQuiescent();
  const workspace = await realpath(options.workspace);
  await mkdir(options.archiveRoot, { recursive: true, mode: 0o700 });
  const archiveRoot = await realpath(options.archiveRoot);
  if (beneath(workspace, archiveRoot) || beneath(archiveRoot, workspace)) {
    throw new Error("Checkpoint storage must be separate from the agent workspace.");
  }
  const temporary = join(archiveRoot, `.pending-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  const files: SourceFile[] = [];
  let total = 0;
  try {
    for (const path of await sourcePaths(workspace)) {
      const bytes = await readSource(workspace, path, maxBytes - total);
      total += bytes.length;
      await durableWrite(join(temporary, "files", path), bytes);
      files.push({ path, bytes: bytes.length, sha256: hashBytes(bytes) });
    }
    await options.assertQuiescent();
    const current = await sourcePaths(workspace);
    if (JSON.stringify(current) !== JSON.stringify(files.map(function path(file) { return file.path; }))) {
      throw new Error("Source tree changed while creating a checkpoint.");
    }
    for (const file of files) {
      if (hashBytes(await readSource(workspace, file.path, file.bytes)) !== file.sha256) {
        throw new Error("Source changed while creating a checkpoint.");
      }
    }
    const manifest: SourceManifest = {
      version: 1, buildId: options.buildId, attempt: options.attempt, stage: options.stage,
      // Session restoration needs provider-specific redaction and compatibility
      // proof. Keep the original session tree untouched; do not archive tokens.
      continuation: "unavailable", files,
    };
    const encoded = JSON.stringify(manifest);
    const hash = hashBytes(encoded);
    await durableWrite(join(temporary, "manifest.json"), encoded);
    await syncTreeDirectories(temporary);
    const path = join(archiveRoot, hash);
    try {
      await rename(temporary, path);
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "EEXIST" && code !== "ENOTEMPTY") throw cause;
      await verifySourceCheckpoint(archiveRoot, hash);
      await rm(temporary, { recursive: true });
    }
    await syncDirectory(archiveRoot);
    return { hash, path, manifest };
  } catch (cause) {
    await rm(temporary, { recursive: true, force: true });
    throw cause;
  }
}

export async function verifySourceCheckpoint(archiveRoot: string, hash: string): Promise<SourceCheckpoint> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid checkpoint hash.");
  const root = await realpath(archiveRoot);
  const path = join(root, hash);
  if (await realpath(path) !== path || !(await lstat(path)).isDirectory()) throw new Error("Invalid checkpoint directory.");
  const encoded = await readSource(path, "manifest.json", 8 * 1024 * 1024);
  if (hashBytes(encoded) !== hash) throw new Error("Checkpoint manifest hash mismatch.");
  const manifest = JSON.parse(encoded.toString("utf8")) as SourceManifest;
  if (manifest.version !== 1 || manifest.continuation !== "unavailable" || !Array.isArray(manifest.files)) {
    throw new Error("Unsupported checkpoint manifest.");
  }
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!safePath(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error("Invalid checkpoint file entry.");
    }
    seen.add(file.path);
    const bytes = await readSource(path, `files/${file.path}`, file.bytes);
    if (bytes.length !== file.bytes || hashBytes(bytes) !== file.sha256) throw new Error("Checkpoint source hash mismatch.");
  }
  return { hash, path, manifest };
}

// Restore only into a new directory. Choosing whether it replaces a newer live
// workspace is a separate reconciliation decision; this helper never does it.
export async function restoreSourceCheckpoint(archiveRoot: string, hash: string, destination: string): Promise<SourceManifest> {
  const checkpoint = await verifySourceCheckpoint(archiveRoot, hash);
  const target = resolve(destination);
  if (beneath(await realpath(archiveRoot), target)) throw new Error("Restore destination must be outside checkpoint storage.");
  const parent = await realpath(dirname(target));
  if (parent !== dirname(target)) throw new Error("Restore parent must not follow symlinks.");
  await mkdir(target, { mode: 0o700 });
  for (const file of checkpoint.manifest.files) {
    const bytes = await readSource(checkpoint.path, `files/${file.path}`, file.bytes);
    if (hashBytes(bytes) !== file.sha256) throw new Error("Checkpoint changed during restore.");
    await mkdir(dirname(join(target, file.path)), { recursive: true, mode: 0o700 });
    await writeFile(join(target, file.path), bytes, { flag: "wx", mode: 0o600 });
  }
  return checkpoint.manifest;
}

// A resumable job may reuse its existing workspace only while it still exactly
// matches the immutable source checkpoint. Never overwrite later work silently.
export async function verifyWorkspaceCheckpoint(archiveRoot: string, hash: string, workspace: string): Promise<void> {
  const saved = await verifySourceCheckpoint(archiveRoot, hash);
  const root = await realpath(workspace);
  const paths = await sourcePaths(root);
  if (JSON.stringify(paths) !== JSON.stringify(saved.manifest.files.map(file => file.path))) throw new Error("Saved workspace file list changed.");
  for (const file of saved.manifest.files) {
    if (hashBytes(await readSource(root, file.path, file.bytes)) !== file.sha256) throw new Error("Saved workspace source changed.");
  }
}
