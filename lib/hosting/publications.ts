import "server-only";
import { pool } from "@/lib/db";
import type { Pool, PoolClient } from "pg";
import { withResourceLock } from "@/lib/build/resource-lock";
import { withBuildCancellation } from "@/lib/build/cancellation";
import { currentRelease, publishSite } from "@/lib/hosting/publish";
import { draftDirectory, draftPreviewUrl, readSiteDraft, verifySiteDraft, type SiteDraft } from "./drafts";
import type { PublicationStatus } from "./publication-types";
import { logEvent } from "@/lib/log";

export class PublicationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function publicationStatus(userId: string, projectId: string, database: Pool = pool): Promise<PublicationStatus | null> {
  const project = (await database.query<{ slug: string; preview_url: string | null }>(
    "select slug,preview_url from projects where id=$1 and user_id=$2", [projectId, userId],
  )).rows[0];
  if (!project) return null;
  const draft = (await database.query<SiteDraft>(`select d.* from site_drafts d join builds b on b.id=d.build_id
    where d.project_id=$1 and b.status='succeeded' order by d.created_at desc,d.build_id desc limit 1`, [projectId])).rows[0];
  const job = (await database.query<{ build_id: string; state: NonNullable<PublicationStatus["job"]>["state"]; error: string | null; previous_release: string | null; started_at: Date | null }>(
    "select build_id,state,error,previous_release,started_at from site_publications where project_id=$1 order by requested_at desc limit 1", [projectId],
  )).rows[0];
  let liveBuildId: string | null = null;
  if (project.preview_url) {
    if (job?.state === "published") liveBuildId = job.build_id;
    else if (job?.started_at) liveBuildId = job.previous_release;
    else liveBuildId = await currentRelease(project.slug);
  }
  return {
    draft: draft ? { buildId: draft.build_id, previewUrl: draftPreviewUrl(draft.build_id), createdAt: draft.created_at.toISOString(), bytes: draft.bytes } : null,
    live: project.preview_url ? { buildId: liveBuildId, url: project.preview_url } : null,
    job: job ? { buildId: job.build_id, state: job.state, error: job.error } : null,
  };
}

async function transaction<T>(database: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

export async function requestPublication(userId: string, projectId: string, buildId: string, database: Pool = pool): Promise<void> {
  await transaction(database, async function request(client) {
    await client.query('select id from "user" where id=$1 for update', [userId]);
    const project = (await client.query("select id from projects where id=$1 and user_id=$2 for update", [projectId, userId])).rows[0];
    if (!project) throw new PublicationError("Project not found.", 404);
    const deleting = await client.query("select 1 from audit_log where id=$1", [`project-delete:${projectId}`]);
    if (deleting.rows.length) throw new PublicationError("This project is being deleted.", 409);
    const draft = (await client.query<{ build_id: string }>(`select d.build_id from site_drafts d join builds b on b.id=d.build_id
      where d.project_id=$1 and b.status='succeeded' order by d.created_at desc,d.build_id desc limit 1`, [projectId])).rows[0];
    if (!draft || draft.build_id !== buildId) throw new PublicationError("The ready version changed. Refresh the preview before publishing.", 409);
    const active = (await client.query<{ build_id: string }>(
      "select build_id from site_publications where project_id=$1 and state in ('queued','publishing')", [projectId],
    )).rows[0];
    if (active && active.build_id !== buildId) throw new PublicationError("A saved version is already publishing. Wait for it to finish.", 409);
    await client.query(`insert into site_publications(build_id,project_id,state) values($1,$2,'queued')
      on conflict(build_id) do update set state='queued',requested_at=clock_timestamp(),attempts=0,
      error=null,finished_at=null
      where site_publications.state='failed'`, [buildId, projectId]);
  });
}

// The session lock is shared by all worker generations. A replacement worker
// can reconcile the recorded job after the previous process releases its lock.
export async function runPublicationOnce(signal: AbortSignal, database: Pool = pool): Promise<void> {
  await withResourceLock("site-publication-queue", async function own(lockSignal) {
    const job = (await database.query<{ build_id: string; project_id: string; state: string; attempts: number; previous_release: string | null; started_at: Date | null }>(
      "select * from site_publications where state in ('queued','publishing') order by requested_at limit 1",
    )).rows[0];
    if (!job) return;
    const draft = await readSiteDraft(job.build_id, database);
    if (!draft) throw new Error("The publication's saved preview is missing.");
    const previous = job.started_at ? job.previous_release : await currentRelease(draft.slug);
    await database.query("update site_publications set state='publishing',started_at=clock_timestamp(),attempts=attempts+1,previous_release=$2 where build_id=$1", [job.build_id, previous]);
    try {
      await verifySiteDraft(draft);
      lockSignal.throwIfAborted();
      const result = await withBuildCancellation(lockSignal, () => publishSite(draft.slug, draft.build_id, draftDirectory(draft), draft.bytes, { previousRelease: previous }));
      lockSignal.throwIfAborted();
      if (!result.ok) {
        await database.query("update site_publications set state='failed',error=$2,finished_at=clock_timestamp() where build_id=$1", [job.build_id, result.error]);
        return;
      }
      await transaction(database, async function confirmed(client) {
        await client.query("update projects set preview_url=$2 where id=$1", [job.project_id, result.url]);
        await client.query("update site_publications set state='published',url=$2,error=null,finished_at=clock_timestamp() where build_id=$1", [job.build_id, result.url]);
      });
    } catch (cause) {
      // Keep an interrupted intent for the next lock owner. It verifies the
      // target and retains the recorded rollback version before another attempt.
      if (lockSignal.aborted) return;
      logEvent("hosting", { event: "publication-job-failed", buildId: job.build_id, message: cause instanceof Error ? cause.message : "Publication error" });
      await database.query("update site_publications set state='failed',error=$2,finished_at=clock_timestamp() where build_id=$1", [job.build_id, "The saved app could not be published. Retry publishing; your build is retained."]);
    }
  }, { database, signal, skipBusy: true });
}
