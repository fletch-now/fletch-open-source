import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { APP_URL } from "@/lib/config";
import { workspaceRoot } from "@/lib/build/workspace";
import { prepareShareMetadata } from "./share-metadata";
import { assertWorkerExecution } from "@/lib/build/durable/execution";

interface DraftFile { bytes: number; sha256: string }
export interface SiteDraft {
  build_id: string; project_id: string; slug: string;
  manifest: Record<string, DraftFile>; bytes: number; created_at: Date;
}
const MAX_BYTES = 10 * 1024 * 1024;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,99}$/;

export function draftsRoot(): string {
  return process.env.FORGE_DRAFTS_ROOT ?? join(dirname(workspaceRoot()), "drafts");
}

export function draftDirectory(draft: Pick<SiteDraft, "slug" | "build_id">): string {
  if (!ID.test(draft.slug) || !ID.test(draft.build_id)) throw new Error("Invalid saved preview identity.");
  return join(draftsRoot(), draft.slug, draft.build_id);
}

function safeSegment(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !value.startsWith(".") && !/[\\/\x00-\x1f\x7f]/.test(value);
}

async function inspectFiles(root: string): Promise<Record<string, DraftFile>> {
  const manifest: Record<string, DraftFile> = Object.create(null);
  let total = 0;
  async function visit(parts: string[]): Promise<void> {
    if (parts.length > 15) throw new Error("The preview has too many nested folders.");
    const directory = join(root, ...parts);
    if (!(await lstat(directory)).isDirectory()) throw new Error("Preview folders must be regular directories.");
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!safeSegment(entry.name)) throw new Error("The preview contains an unsupported file name.");
      if (entry.isDirectory()) { await visit([...parts, entry.name]); continue; }
      if (!entry.isFile()) throw new Error("Preview files must not contain links or devices.");
      const path = [...parts, entry.name].join("/");
      const file = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        total += stat.size;
        if (!stat.isFile() || total > MAX_BYTES || Object.keys(manifest).length >= 2000) throw new Error("The preview exceeds its storage limit.");
        const body = await file.readFile();
        manifest[path] = { bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
      } finally { await file.close(); }
    }
  }
  await visit([]);
  if (!manifest["index.html"] || total === 0) throw new Error("The preview has no index page.");
  return manifest;
}

export async function readSiteDraft(buildId: string, database: Pool = pool): Promise<SiteDraft | null> {
  if (!ID.test(buildId)) return null;
  return (await database.query<SiteDraft>("select * from site_drafts where build_id=$1", [buildId])).rows[0] ?? null;
}

async function moveDraft(dist: string, root: string, manifest: Record<string, DraftFile>): Promise<void> {
  try {
    await rename(dist, root);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  // systemd can bind-mount writable workspaces separately even on the same
  // disk. Copy checked bytes into the destination, then commit by local rename.
  const temporary = await mkdtemp(join(dirname(root), ".preparing-"));
  try {
    for (const [path, expected] of Object.entries(manifest)) {
      const file = await open(join(dist, path), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size !== expected.bytes) throw new Error("The preview changed while being saved.");
        const body = await file.readFile();
        if (createHash("sha256").update(body).digest("hex") !== expected.sha256) throw new Error("The preview changed while being saved.");
        const target = join(temporary, path);
        await mkdir(dirname(target), { recursive: true, mode: 0o755 });
        await writeFile(target, body, { flag: "wx", mode: 0o644 });
      } finally { await file.close(); }
    }
    await assertWorkerExecution();
    await chmod(temporary, 0o755);
    await rename(temporary, root);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  // Keep source output until its immutable destination has been committed.
  await assertWorkerExecution();
  await rm(dist, { recursive: true });
}

// Save only the validated output, after the sandbox has exited. Future builds
// can replace workspace/dist without changing this version or a live site.
export async function prepareSiteDraft(buildId: string, dist: string, database: Pool = pool): Promise<SiteDraft> {
  const prior = await readSiteDraft(buildId, database);
  if (prior) return prior;
  const row = (await database.query<{ project_id: string; slug: string; name: string }>(
    "select b.project_id,p.slug,p.name from builds b join projects p on p.id=b.project_id where b.id=$1", [buildId],
  )).rows[0];
  if (!row) throw new Error("The project for this preview is unavailable.");
  const root = draftDirectory({ ...row, build_id: buildId });
  const existing = await lstat(root).catch(function missing(error: NodeJS.ErrnoException) {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!existing) {
    await inspectFiles(dist);
    await prepareShareMetadata(dist, join(workspaceRoot(), row.slug), row.slug, row.name);
  }
  const manifest = await inspectFiles(existing ? root : dist);
  await assertWorkerExecution();
  if (!existing) {
    await mkdir(dirname(root), { recursive: true, mode: 0o750 });
    await moveDraft(dist, root, manifest);
  }
  await assertWorkerExecution();
  const bytes = Object.values(manifest).reduce((sum, file) => sum + file.bytes, 0);
  const result = await database.query<SiteDraft>(`insert into site_drafts(build_id,project_id,slug,manifest,bytes)
    values($1,$2,$3,$4,$5) on conflict(build_id) do nothing returning *`, [buildId, row.project_id, row.slug, JSON.stringify(manifest), bytes]);
  const draft = result.rows[0] ?? await readSiteDraft(buildId, database);
  if (!draft) throw new Error("The saved preview could not be recorded.");
  return draft;
}

function tokenSignature(buildId: string, expires: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Preview signing is unavailable.");
  return createHmac("sha256", secret).update(`fletch-preview-v1:${buildId}:${expires}`).digest("base64url");
}

export function draftPreviewUrl(buildId: string, now = Date.now()): string {
  if (!ID.test(buildId)) throw new Error("Invalid preview identity.");
  const expires = String(Math.floor(now / 1000) + 1800);
  return `${APP_URL}/api/previews/${buildId}/${expires}.${tokenSignature(buildId, expires)}/index.html`;
}

export function validPreviewToken(buildId: string, token: string, now = Date.now()): boolean {
  if (!ID.test(buildId) || !/^\d{10}\.[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const [expires, signature] = token.split(".");
  const remaining = Number(expires) - Math.floor(now / 1000);
  if (remaining <= 0 || remaining > 3600) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(tokenSignature(buildId, expires)));
}

export async function readDraftFile(draft: SiteDraft, path: string[]): Promise<Buffer | null> {
  if (!path.length || path.some(part => !safeSegment(part))) return null;
  if (!Object.hasOwn(draft.manifest, path.join("/"))) return null;
  const expected = draft.manifest[path.join("/")];
  if (!expected || expected.bytes > MAX_BYTES) return null;
  let directory = draftDirectory(draft);
  for (const part of path.slice(0, -1)) {
    directory = join(directory, part);
    if (!(await lstat(directory)).isDirectory()) return null;
  }
  if (!(await lstat(draftDirectory(draft))).isDirectory()) return null;
  const file = await open(join(directory, path.at(-1)!), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size !== expected.bytes) return null;
    const body = await file.readFile();
    if (createHash("sha256").update(body).digest("hex") !== expected.sha256) return null;
    return body;
  } finally { await file.close(); }
}

export async function verifySiteDraft(draft: SiteDraft): Promise<void> {
  const actual = await inspectFiles(draftDirectory(draft));
  if (Object.keys(actual).length !== Object.keys(draft.manifest).length) {
    throw new Error("The saved preview changed. Build an update before publishing.");
  }
  for (const [path, expected] of Object.entries(draft.manifest)) {
    if (actual[path]?.bytes !== expected.bytes || actual[path]?.sha256 !== expected.sha256) {
      throw new Error("The saved preview changed. Build an update before publishing.");
    }
  }
}
