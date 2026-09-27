import "server-only";
import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db, pool } from "@/lib/db";
import { auditLog, builds, projects } from "@/lib/db/schema";
import { directoryBytes, workspaceRoot } from "@/lib/build/workspace";
import { withSiteLock } from "@/lib/hosting/site-lock";
import { draftsRoot } from "@/lib/hosting/drafts";
import { sitesRoot } from "@/lib/hosting/publish";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;

export class ProjectDeletionError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 410) {
    super(message);
    this.name = "ProjectDeletionError";
  }
}

function intentId(projectId: string): string {
  return `project-delete:${projectId}`;
}

function completedId(projectId: string): string {
  return `project-deleted:${projectId}`;
}

// Admission already holds this user's row lock, so deletion and a new debit cannot race.
export async function assertProjectNotDeleting(tx: Transaction, userId: string, projectId: string): Promise<void> {
  const [intent] = await tx.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.id, intentId(projectId)), eq(auditLog.userId, userId))).limit(1);
  if (!intent) return;
  const [completed] = await tx.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.id, completedId(projectId)), eq(auditLog.userId, userId))).limit(1);
  if (completed) throw new ProjectDeletionError("This project was deleted. Start a new app.", 410);
  throw new ProjectDeletionError("This project is being deleted. Retry Delete to finish before starting another build.", 409);
}

async function assertTerminal(tx: Transaction, projectId: string): Promise<void> {
  const publishing = await tx.execute(sql`select 1 from site_publications where project_id=${projectId} and state in ('queued','publishing') limit 1`);
  if (publishing.rows.length) throw new ProjectDeletionError("This app is publishing. Let it finish before deleting.", 409);
  const unfinished = await tx.execute(sql`
    select 1 from builds where project_id=${projectId}
      and status not in ('succeeded','failed','killed') limit 1
  `);
  if (unfinished.rows.length) {
    throw new ProjectDeletionError("A build is queued or running. Cancel it, stop it or let it finish before deleting.", 409);
  }
  const unsafe = await tx.execute(sql`
    select 1 from build_worker_jobs j left join builds b on b.id=j.build_id
    where (b.project_id=${projectId} or j.workspace_key=${`project:${projectId}`})
      and (j.state not in ('completed','stopped') or j.lease_expires_at is not null
        or exists (select 1 from build_worker_effects e where e.build_id=j.build_id and e.state='uncertain'))
    limit 1
  `);
  if (unsafe.rows.length) {
    throw new ProjectDeletionError("This project's build needs recovery before it can be deleted. Its files have been kept.", 409);
  }
}

async function removeTree(path: string): Promise<number> {
  const entry = await lstat(path).catch(function missing(error: NodeJS.ErrnoException) {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!entry) return 0;
  const bytes = entry.isSymbolicLink() ? 0 : await directoryBytes(path);
  await rm(path, { recursive: true, force: true });
  return bytes;
}

interface DeleteOptions {
  // Tests keep the real filesystem operation and inject a failure or concurrent request.
  removeTree?: (path: string) => Promise<number>;
}

export interface DeletedProject {
  ok: true;
  freedBytes: number;
}

async function lockUser(tx: Transaction, userId: string): Promise<boolean> {
  const locked = await tx.execute(sql`select id from "user" where id=${userId} for update`);
  return locked.rows.length > 0;
}

async function completedDeletion(tx: Transaction, userId: string, projectId: string): Promise<DeletedProject | null> {
  const [completed] = await tx.select({ metadata: auditLog.metadata }).from(auditLog)
    .where(and(eq(auditLog.id, completedId(projectId)), eq(auditLog.userId, userId))).limit(1);
  if (!completed) return null;
  const metadata = completed.metadata as { freedBytes?: unknown } | null;
  const bytes = metadata?.freedBytes;
  return { ok: true, freedBytes: typeof bytes === "number" && Number.isFinite(bytes) ? bytes : 0 };
}

export async function deleteProject(userId: string, projectId: string, options: DeleteOptions = {}): Promise<DeletedProject | null> {
  const prepared = await db.transaction(async function prepare(tx) {
    if (!await lockUser(tx, userId)) return false;
    if (await completedDeletion(tx, userId, projectId)) return { slug: null };
    const [project] = await tx.select().from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
    if (!project) return false;
    if (!SLUG.test(project.slug)) throw new ProjectDeletionError("Project slug is not a valid path.", 400);
    await assertTerminal(tx, projectId);
    await tx.insert(auditLog).values({
      id: intentId(projectId), userId, actorType: "user", action: "project.delete_requested",
      resourceType: "project", resourceId: projectId, metadata: { slug: project.slug },
    }).onConflictDoNothing({ target: auditLog.id });
    return { slug: project.slug };
  });
  if (!prepared) return null;
  const preparedSlug = prepared.slug;

  // Keep the slug and user lock until cleanup commits. Parallel retries must not
  // delete files belonging to a later project that reuses the old slug. The intent
  // survives filesystem errors, a failed commit and process restarts.
  async function finishDeletion(): Promise<DeletedProject | null> {
    return db.transaction(async function finish(tx) {
      if (!await lockUser(tx, userId)) return null;
      const completed = await completedDeletion(tx, userId, projectId);
      if (completed) return completed;
      const [project] = await tx.select().from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.userId, userId))).for("update");
      if (!project) return null;
      await assertTerminal(tx, projectId);
      if (!SLUG.test(project.slug)) throw new ProjectDeletionError("Project slug is not a valid path.", 400);
      if (preparedSlug !== project.slug) throw new ProjectDeletionError("The project changed while preparing deletion. Retry Delete.", 409);
      const remove = options.removeTree ?? removeTree;
      const freedBytes = await remove(join(workspaceRoot(), project.slug)) + await remove(join(sitesRoot(), project.slug)) + await remove(join(draftsRoot(), project.slug));
      const retainedBuilds = await tx.update(builds).set({ projectId: null }).where(eq(builds.projectId, projectId)).returning({ id: builds.id });
      await tx.delete(projects).where(and(eq(projects.id, projectId), eq(projects.userId, userId)));
      await tx.insert(auditLog).values({
        id: completedId(projectId), userId, actorType: "user", action: "project.deleted",
        resourceType: "project", resourceId: projectId,
        metadata: { slug: project.slug, freedBytes, buildIds: retainedBuilds.map(function id(build) { return build.id; }),
          retained: "build receipts, checkpoints and credit history" },
      });
      return { ok: true, freedBytes };
    });
  }
  if (preparedSlug === null) return finishDeletion();
  // Wait outside the user/project transaction so cleanup cannot occupy the
  // ordinary pool while a publisher needs it to finish its durable receipt.
  return withSiteLock(sitesRoot(), preparedSlug, async function removeOwnedSite(signal) {
    signal.throwIfAborted();
    return finishDeletion();
  }, { database: pool });
}
