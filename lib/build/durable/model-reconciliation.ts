import "server-only";
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { Pool } from "pg";
import { workspaceRoot } from "@/lib/build/workspace";
import { createSourceCheckpoint } from "./checkpoints";
import { removeOwnedContainer } from "./execution";
import { workerTransaction, type WorkerClaim } from "./ownership";
import { settleRecoveredModelFailure } from "./runner";

interface PausedModelBuild {
  build_id: string;
  workspace_key: string;
  owner_id: string | null;
  fence: string | null;
  attempt: number;
  checkpoint_hash: string | null;
  sandbox_id: string | null;
  project_id: string | null;
  uncertain_model: boolean;
  uncertain_other: boolean;
}

export interface ModelReconciliationOptions {
  buildId: string;
  apply?: boolean;
  archiveRoot?: string;
  verifyWorkerStopped: () => Promise<void>;
}

export interface ModelReconciliationReport {
  buildId: string;
  kind: "model";
  outcome: "held" | "ready" | "applied";
  reason: string;
  checkpointHash?: string;
}

function overlaps(left: string, right: string): boolean {
  return left === right || left.startsWith(right.endsWith(sep) ? right : right + sep)
    || right.startsWith(left.endsWith(sep) ? left : left + sep);
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await promisify(execFile)("docker", args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function containerMountInventory(): Promise<string[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ids = (await docker(["container", "ls", "--all", "--quiet", "--no-trunc"])).trim().split(/\s+/).filter(Boolean);
    if (!ids.length) return [];
    if (ids.some(function invalid(id) { return !/^[a-f0-9]{64}$/.test(id); })) throw new Error("Container inventory could not be verified.");
    let inventory: string;
    try { inventory = await docker(["inspect", "--format", "{{json .Mounts}}", ...ids]); }
    catch (cause) {
      const error = cause as { code?: number; stderr?: string };
      const errors = typeof error.stderr === "string" ? error.stderr.trim().split("\n") : [];
      const disappeared = error.code === 1 && errors.length > 0 && errors.every(function missing(line) {
        const match = /^error: no such object: ([a-f0-9]{64})$/i.exec(line.trim());
        return match !== null && ids.includes(match[1]);
      });
      if (!disappeared || attempt === 2) throw cause;
      continue;
    }
    const rows = inventory.trim().split("\n");
    if (rows.length !== ids.length) throw new Error("Container mount inventory is incomplete.");
    return rows;
  }
  throw new Error("Container mount inventory did not stabilize.");
}

// Include stopped containers: they could restart independently of the worker.
export async function assertWorkspaceQuiescent(workspace: string): Promise<void> {
  for (const row of await containerMountInventory()) {
    const mounts = JSON.parse(row) as { Type: string; Source: string; RW: boolean }[];
    if (!Array.isArray(mounts)) throw new Error("Container mounts could not be verified.");
    for (const mount of mounts) {
      if (mount.Type !== "bind" && mount.Type !== "volume") continue;
      if (typeof mount.RW !== "boolean" || typeof mount.Source !== "string" || !isAbsolute(mount.Source)) {
        throw new Error("Container mount ownership is incomplete.");
      }
      if (!mount.RW) continue;
      let source = resolve(mount.Source);
      try { source = await realpath(source); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
      if (overlaps(workspace, source)) throw new Error("Another container has a writable mount overlapping this workspace. Keep the build paused.");
    }
  }
}

export async function reconcileModelFailure(pool: Pool, options: ModelReconciliationOptions): Promise<ModelReconciliationReport> {
  const report: ModelReconciliationReport = { buildId: options.buildId, kind: "model", outcome: "held", reason: "No paused model failure with expired ownership was found." };
  const result = await pool.query<PausedModelBuild>(`
    select j.build_id,j.workspace_key,j.owner_id,j.fence,j.attempt,j.checkpoint_hash,b.sandbox_id,b.project_id,
      exists(select 1 from build_worker_effects e where e.build_id=j.build_id and e.state='uncertain' and e.kind='model') as uncertain_model,
      exists(select 1 from build_worker_effects e where e.build_id=j.build_id and e.state='uncertain' and e.kind<>'model') as uncertain_other
    from build_worker_jobs j join builds b on b.id=j.build_id
    where j.build_id=$1 and j.state='recovery_required' and b.status in ('provisioning','building','compiling')
      and j.lease_expires_at<=clock_timestamp()
  `, [options.buildId]);
  const saved = result.rows[0];
  if (!saved) return report;
  if (!saved.owner_id || !saved.fence || saved.attempt < 1) return { ...report, reason: "Saved worker ownership is incomplete. Keep the build paused." };
  if (saved.uncertain_other) return { ...report, reason: "A non-model operation remains uncertain. Reconcile its outcome separately." };
  if (!saved.uncertain_model) return { ...report, reason: "No uncertain model operation was found. This command only settles model failures." };
  if (!options.apply) return { ...report, outcome: "ready", reason: "After the worker is stopped, verify workspace cleanup, save a checkpoint and fail this build with unknown provider usage. Any owned Fletch debit will be refunded once." };

  const archiveRoot = options.archiveRoot ?? process.env.FORGE_CHECKPOINT_ROOT;
  if (!archiveRoot) throw new Error("Persistent checkpoint storage is required for model reconciliation.");
  const claim: WorkerClaim = { buildId: saved.build_id, workspaceKey: saved.workspace_key, ownerId: saved.owner_id,
    fence: saved.fence, attempt: saved.attempt, checkpointHash: saved.checkpoint_hash };
  await options.verifyWorkerStopped();
  const checkpointHash = await workerTransaction(pool, async function apply(client) {
    const locked = await client.query(`
      select j.build_id from build_worker_jobs j join builds b on b.id=j.build_id
      where j.build_id=$1 and j.state='recovery_required' and j.owner_id=$2 and j.fence=$3 and j.attempt=$4
        and j.workspace_key=$5 and b.sandbox_id is not distinct from $6 and b.project_id is not distinct from $7
        and b.status in ('provisioning','building','compiling')
        and j.lease_expires_at<=clock_timestamp()
      for update of j,b
    `, [claim.buildId, claim.ownerId, claim.fence, claim.attempt, claim.workspaceKey, saved.sandbox_id, saved.project_id]);
    if (!locked.rows[0]) throw new Error("The paused attempt changed during reconciliation.");
    const unsafe = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' and kind<>'model' limit 1", [claim.buildId]);
    if (unsafe.rows[0]) throw new Error("A non-model operation appeared during reconciliation.");
    await options.verifyWorkerStopped();
    let slug = claim.buildId;
    if (saved.project_id) {
      const project = await client.query<{ slug: string }>("select slug from projects where id=$1 for share", [saved.project_id]);
      if (!project.rows[0]) throw new Error("The saved project is unavailable. Keep this build paused.");
      slug = project.rows[0].slug;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(slug)) throw new Error("The saved workspace name is invalid.");
    const root = await realpath(workspaceRoot());
    const workspace = join(root, slug);
    if (await realpath(workspace) !== workspace) throw new Error("The saved workspace must not follow a symlink.");
    if (saved.sandbox_id) {
      const other = await client.query("select 1 from builds where id<>$1 and sandbox_id=$2 limit 1", [claim.buildId, saved.sandbox_id]);
      if (other.rows[0]) throw new Error("Recorded sandbox ownership is shared. Keep this build paused.");
      await removeOwnedContainer(saved.sandbox_id);
    }
    async function quiescent(): Promise<void> {
      await options.verifyWorkerStopped();
      await assertWorkspaceQuiescent(workspace);
    }
    const checkpoint = await createSourceCheckpoint({ workspace, archiveRoot, buildId: claim.buildId,
      attempt: claim.attempt, stage: "operator_model_failure", assertQuiescent: quiescent });
    await quiescent();
    await settleRecoveredModelFailure(client, claim, checkpoint.hash);
    return checkpoint.hash;
  });
  return { ...report, outcome: "applied", checkpointHash, reason: "Source checkpoint saved. Build failed with unknown provider usage; any owned Fletch debit was refunded once. Any previous publication is retained." };
}
