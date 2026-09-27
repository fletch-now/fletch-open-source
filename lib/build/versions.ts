import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { pool } from "@/lib/db";
import { restoreSourceCheckpoint, verifySourceCheckpoint, type SourceCheckpoint } from "./durable/checkpoints";
import { workerTransaction } from "./durable/ownership";
import { workspaceRoot } from "./workspace";
import { isSafeRelativePath, readWorkspaceFile } from "./workspace-files";
import { summariseBuild } from "./history";
import { recoverBuildBrief } from "./recover-brief";
import type { BuildAttachment } from "./types";
import type { ProjectVersion, ProjectVersionDetail, RestoredProject } from "./version-types";

type Database = Pick<Pool, "query"> | PoolClient;

interface VersionRow {
  id: string;
  build_id: string;
  prompt: string;
  status: string;
  created_at: Date;
  checkpoint_hash: string | null;
  attachments: BuildAttachment[] | null;
  project_requests: string[] | null;
}

export class VersionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "VersionError";
  }
}

// Restore receipts are separate from builds: copying saved source must never
// manufacture a successful model run or a new toolchain/deployment verdict.
async function versionRows(database: Database, userId: string, projectId: string, versionId: string | null = null): Promise<VersionRow[] | null> {
  const owned = await database.query("select id from projects where id=$1 and user_id=$2", [projectId, userId]);
  if (!owned.rows.length) return null;
  const result = await database.query<VersionRow>(`
    select * from (
      select b.id,b.id as build_id,b.prompt,b.status::text,b.created_at,j.checkpoint_hash,b.attachments,null::jsonb as project_requests
      from builds b left join build_worker_jobs j on j.build_id=b.id
      where b.project_id=$1 and b.user_id=$2
      union all
      select a.id,a.metadata->>'sourceBuildId',a.metadata->>'prompt','restored',a.created_at,
        a.metadata->>'checkpointHash',a.metadata->'attachments',a.metadata->'projectRequests'
      from audit_log a where a.resource_id=$1 and a.user_id=$2 and a.action='project.source_restored'
    ) versions where ($3::text is null or id=$3) order by created_at desc,id desc limit 100
  `, [projectId, userId, versionId]);
  return result.rows;
}

function publicVersion(row: VersionRow): ProjectVersion {
  return { id: row.id, buildId: row.build_id, prompt: row.prompt, status: row.status,
    createdAt: row.created_at.toISOString(), sourceAvailable: Boolean(process.env.FORGE_CHECKPOINT_ROOT && row.checkpoint_hash) };
}

export async function listProjectVersions(userId: string, projectId: string): Promise<ProjectVersion[] | null> {
  const rows = await versionRows(pool, userId, projectId);
  return rows?.map(publicVersion) ?? null;
}

async function savedSource(row: VersionRow): Promise<SourceCheckpoint> {
  const root = process.env.FORGE_CHECKPOINT_ROOT;
  if (!root || !row.checkpoint_hash) throw new VersionError("Saved source is unavailable for this version. Its recorded results are still available.", 409);
  try {
    const checkpoint = await verifySourceCheckpoint(root, row.checkpoint_hash);
    if (checkpoint.manifest.buildId !== row.build_id) throw new Error("Source belongs to a different build.");
    return checkpoint;
  } catch {
    throw new VersionError("This version's saved source could not be verified. Your current app is unchanged.", 409);
  }
}

export async function getProjectVersion(userId: string, projectId: string, versionId: string): Promise<ProjectVersionDetail | null> {
  const row = (await versionRows(pool, userId, projectId, versionId))?.[0];
  if (!row) return null;
  let checkpoint: SourceCheckpoint | null = null;
  let sourceError: string | null = null;
  try { checkpoint = await savedSource(row); } catch (error) { sourceError = (error as Error).message; }
  const summary = await summariseBuild(row.build_id);
  return { ...publicVersion(row), ...summary, sourceAvailable: checkpoint !== null,
    sourceHash: checkpoint?.hash ?? null,
    sourceStage: checkpoint?.manifest.stage ?? null, sourceError,
    files: checkpoint?.manifest.files.map(function path(file) { return file.path; }).filter(isSafeRelativePath) ?? [] };
}

export async function getProjectVersionFile(userId: string, projectId: string, versionId: string, path: string): Promise<string | null> {
  if (!isSafeRelativePath(path)) throw new VersionError("Invalid source path.", 400);
  const row = (await versionRows(pool, userId, projectId, versionId))?.[0];
  if (!row) return null;
  const checkpoint = await savedSource(row);
  if (!checkpoint.manifest.files.some(function matches(file) { return file.path === path; })) return null;
  return readWorkspaceFile(join(checkpoint.path, "files"), path);
}

interface RestoreOptions {
  database?: Pool;
  restoreSource?: typeof restoreSourceCheckpoint;
}

export async function restoreProjectVersion(userId: string, projectId: string, versionId: string, requestId: string, sourceHash: string, options: RestoreOptions = {}): Promise<RestoredProject | null> {
  if (!/^[a-f0-9-]{36}$/i.test(requestId)) throw new VersionError("Invalid restore request.", 400);
  if (!/^[a-f0-9]{64}$/.test(sourceHash)) throw new VersionError("Inspect the saved source before restoring it.", 400);
  const database = options.database ?? pool;
  return workerTransaction(database, async function restore(client) {
    const locked = await client.query('select id from "user" where id=$1 for update', [userId]);
    if (!locked.rows.length) return null;
    const receiptId = `source-restore:${userId}:${requestId}`;
    const previous = await client.query<{ metadata: Record<string, unknown> }>("select metadata from audit_log where id=$1 and user_id=$2", [receiptId, userId]);
    if (previous.rows[0]) {
      const metadata = previous.rows[0].metadata;
      if (metadata.sourceProjectId !== projectId || metadata.versionId !== versionId || metadata.checkpointHash !== sourceHash) throw new VersionError("This restore request was already used for another version.", 409);
      const restored = await client.query<RestoredProject>('select id as "projectId",slug,name from projects where id=$1 and user_id=$2', [metadata.projectId, userId]);
      if (!restored.rows[0]) throw new VersionError("The restored copy was deleted. Start a new restore.", 410);
      return restored.rows[0];
    }
    const project = await client.query<{ name: string; template: string | null }>("select name,template from projects where id=$1 and user_id=$2 for update", [projectId, userId]);
    if (!project.rows[0]) return null;
    const deleting = await client.query("select 1 from audit_log where id=$1 and user_id=$2", [`project-delete:${projectId}`, userId]);
    if (deleting.rows.length) throw new VersionError("Finish this app's pending deletion before restoring a copy.", 409);
    const row = (await versionRows(client, userId, projectId, versionId))?.[0];
    if (!row) return null;
    const checkpoint = await savedSource(row);
    if (checkpoint.hash !== sourceHash) throw new VersionError("The saved source changed. Reopen this version before restoring it.", 409);
    if (!checkpoint.manifest.files.length) throw new VersionError("This version has no saved source files to restore.", 409);
    let requests = row.project_requests;
    let attachments = row.attachments ?? [];
    if (!requests) {
      const brief = await recoverBuildBrief(client, { buildId: row.build_id, prompt: row.prompt, attachments, slug: "restored", ownerAddress: null }, userId, projectId);
      requests = [brief.projectRequests?.[0], row.prompt].filter(function present(prompt): prompt is string { return Boolean(prompt); });
      attachments = brief.attachments ?? [];
    }
    const id = randomUUID();
    const slug = `forge-restored-${id.replaceAll("-", "")}`;
    const name = `${project.rows[0].name.slice(0, 44)} (restored copy)`;
    await mkdir(workspaceRoot(), { recursive: true });
    const root = await realpath(workspaceRoot());
    // The destination is new and unknown to workers until the transaction
    // commits. No original workspace, lease or publication pointer is touched.
    // On an uncertain commit leave these bytes intact for receipt-based retry.
    await (options.restoreSource ?? restoreSourceCheckpoint)(process.env.FORGE_CHECKPOINT_ROOT!, checkpoint.hash, join(root, slug));
    await client.query("insert into projects(id,user_id,slug,name,name_source,template) values($1,$2,$3,$4,'user',$5)", [id, userId, slug, name, project.rows[0].template]);
    await client.query(`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values($1,$2,'user','project.source_restored','project',$3,$4)`, [receiptId, userId, id, JSON.stringify({
      projectId: id, sourceProjectId: projectId, versionId, sourceBuildId: row.build_id,
      checkpointHash: checkpoint.hash, prompt: row.prompt, projectRequests: [...new Set(requests)], attachments,
    })]);
    return { projectId: id, slug, name };
  });
}
