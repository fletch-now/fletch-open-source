import type { Pool } from "pg";
import { join } from "node:path";
import { workspaceRoot } from "@/lib/build/workspace";
import { queueCleanAgentContinuation } from "./continuation";

export interface ContinueReading {
  status: number;
  queued?: boolean;
  running?: boolean;
  message?: string;
  error?: string;
}

export async function continueOwnedBuild(database: Pool, buildId: string, userId: string): Promise<ContinueReading> {
  const result = await database.query<{ state: string; slug: string | null; stop_requested_at: Date | null }>(`
    select j.state,p.slug,j.stop_requested_at from builds b join build_worker_jobs j on j.build_id=b.id
    left join projects p on p.id=b.project_id where b.id=$1 and b.user_id=$2`, [buildId, userId]);
  const build = result.rows[0];
  if (!build) return { status: 404, error: "Build not found." };
  if (build.stop_requested_at) return { status: 409, error: "This build was stopped. Its saved source is retained." };
  if (build.state === "running") return { status: 200, running: true, message: "This build is already running." };
  if (build.state === "queued") return { status: 200, queued: true, message: "This build is already queued." };
  if (build.state === "paused_budget") return { status: 409, error: "Review the next allowance to continue this build." };
  if (build.state !== "recovery_required") return { status: 409, error: "This build has finished. Send a follow-up prompt to make another change." };
  const archiveRoot = process.env.FORGE_CHECKPOINT_ROOT;
  if (!archiveRoot) return { status: 503, error: "Saved progress is temporarily unavailable. Recovery will retry automatically." };
  try {
    const queued = await queueCleanAgentContinuation({ pool: database, archiveRoot, workspace: join(workspaceRoot(), build.slug ?? buildId) }, buildId);
    if (queued) return { status: 202, queued: true, message: "Saved progress is queued to continue under the existing build allowance." };
  } catch {
    return { status: 409, error: "We could not verify a safe restart point. Your files are saved; the previous request or transaction still needs to be checked before continuing." };
  }
  return { status: 409, error: "The worker is still checking the interruption. Recovery will retry automatically; you can check again shortly." };
}
