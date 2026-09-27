import { reserveDailyBuild } from "@/lib/ratelimit";
import { prepareQuoteAcceptance, recordQuoteAcceptance, replayPricingAcceptance, type QuoteApproval } from "./pricing-quotes";
import { workerBuildsEnabled } from "@/lib/build/durable/routing";
import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";
import { builds, creditEvents, projects } from "@/lib/db/schema";
import { assertProjectNotDeleting } from "@/lib/projects/delete";
import { generateSlug } from "@/lib/slug";
import { snapshotSelection, type ExecutionSnapshot } from "@/lib/agent/user-keys";
import { validateAttachments } from "@/lib/build/attachment-images";
import { isImageAttachment } from "@/lib/build/attachments";
import { BuildSelectionError } from "@/lib/agent/selection";
import type { BuildSelection } from "@/lib/agent/selection";
import type { BuildAttachment } from "@/lib/build/types";

export interface CreatedBuild extends ExecutionSnapshot {
  buildId: string;
  slug: string;
  // The client needs this to send a follow-up prompt against the same app.
  projectId: string;
}

// Creates the project + build rows AND debits one credit in a single transaction,
// with the user row locked FOR UPDATE. Either everything commits or nothing does —
// so a failed insert never leaves a charged-but-buildless user, and two concurrent
// requests can't both spend the last credit. Returns null when out of credits (or
// the user row is absent, which also locks nothing to spend).
// A follow-up prompt on an existing project: same credit guarantees, but it reuses
// the project so the agent resumes its session and edits the files already there.
// Returns null when the user is out of credits or does not own the project.
// Thrown inside the debit transaction when the account already has a build
// running: checked under the user row's lock, so two concurrent requests
// cannot both slip past the rule.
export class BuildInFlightError extends Error {
  constructor() {
    super("One build at a time. Wait for the current one to finish.");
    this.name = "BuildInFlightError";
  }
}

async function assertNoBuildInFlight(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string): Promise<void> {
  const running = await tx
    .select({ n: sql<string>`count(*)` })
    .from(builds)
    .where(and(eq(builds.userId, userId), inArray(builds.status, RUNNING_BUILD_STATUSES)));
  if (Number(running[0]?.n ?? 0) > 0) {
    throw new BuildInFlightError();
  }
}

export async function createFollowUpBuild(
  userId: string,
  projectId: string,
  prompt: string,
  attachments: BuildAttachment[] = [],
  selection: BuildSelection = { billingMode: "platform" },
  approval?: QuoteApproval,
): Promise<CreatedBuild | null> {
  attachments = await validateAttachments(attachments);
  return db.transaction(async function run(tx): Promise<CreatedBuild | null> {
    const locked = await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    if ((locked.rowCount ?? 0) === 0) {
      return null;
    }
    await assertProjectNotDeleting(tx, userId, projectId);
    const replay = await replayPricingAcceptance(tx, userId, approval);
    if (replay) return replay as unknown as CreatedBuild;
    await assertNoBuildInFlight(tx, userId);
    const execution = await snapshotSelection(tx, userId, selection);
    if (attachments.some(isImageAttachment) && !execution.capabilities.images) {
      throw new BuildSelectionError("This connection does not support image input. Select a vision-capable model or remove the images.");
    }
    const quote = await prepareQuoteAcceptance(tx, userId, { prompt, projectId, attachments, selection }, execution, approval);
    const credits = quote?.snapshot.fixedCredits ?? (execution.billingMode === "platform" ? 1 : 0);
    const chargeCredit = credits > 0;

    const owned = await tx
      .select({ id: projects.id, slug: projects.slug })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
      .limit(1);
    const project = owned[0];
    if (!project) {
      return null;
    }

    if (chargeCredit) {
      const balanceRows = await tx
        .select({ balance: sql<string>`coalesce(sum(${creditEvents.delta}), 0)` })
        .from(creditEvents)
        .where(eq(creditEvents.userId, userId));
      if (Number(balanceRows[0]?.balance ?? 0) < credits) {
        return null;
      }
    }

    await reserveDailyBuild(statement => tx.execute(statement));
    const buildId = randomUUID();
    await tx.insert(builds).values({
      id: buildId,
      projectId: project.id,
      userId,
      prompt,
      attachments: attachments.length > 0 ? attachments : null,
      ...execution,
      pricingQuoteId: quote?.id ?? null,
      pricingSnapshot: quote?.snapshot ?? null,
      status: "queued",
    });
    if (workerBuildsEnabled()) await tx.execute(sql`
      insert into build_worker_jobs(build_id,workspace_key)
      select id,'project:'||project_id from builds where id=${buildId}
    `);
    if (quote) await recordQuoteAcceptance(tx, userId, buildId, quote);
    if (chargeCredit && !quote) {
      await tx
        .insert(creditEvents)
        .values({
          id: randomUUID(),
          userId,
          delta: -1,
          reason: "build_debit",
          buildId,
          idempotencyKey: `build_debit:${buildId}`,
        })
        .onConflictDoNothing({ target: creditEvents.idempotencyKey });
    }

    return { buildId, slug: project.slug, projectId: project.id, ...execution };
  });
}

export async function createBuildWithCredit(
  userId: string,
  prompt: string,
  attachments: BuildAttachment[] = [],
  selection: BuildSelection = { billingMode: "platform" },
  approval?: QuoteApproval,
): Promise<CreatedBuild | null> {
  attachments = await validateAttachments(attachments);
  return db.transaction(async function run(tx): Promise<CreatedBuild | null> {
    const locked = await tx.execute(sql`select id from "user" where id = ${userId} for update`);
    if ((locked.rowCount ?? 0) === 0) {
      return null;
    }
    const replay = await replayPricingAcceptance(tx, userId, approval);
    if (replay) return replay as unknown as CreatedBuild;
    await assertNoBuildInFlight(tx, userId);
    const execution = await snapshotSelection(tx, userId, selection);
    if (attachments.some(isImageAttachment) && !execution.capabilities.images) {
      throw new BuildSelectionError("This connection does not support image input. Select a vision-capable model or remove the images.");
    }
    const quote = await prepareQuoteAcceptance(tx, userId, { prompt, attachments, selection }, execution, approval);
    const credits = quote?.snapshot.fixedCredits ?? (execution.billingMode === "platform" ? 1 : 0);
    const chargeCredit = credits > 0;

    if (chargeCredit) {
      const balanceRows = await tx
        .select({ balance: sql<string>`coalesce(sum(${creditEvents.delta}), 0)` })
        .from(creditEvents)
        .where(eq(creditEvents.userId, userId));
      if (Number(balanceRows[0]?.balance ?? 0) < credits) {
        return null;
      }
    }

    let projectId: string | undefined;
    let slug: string | undefined;
    for (let attempt = 0; attempt < 5 && !slug; attempt += 1) {
      const candidate = generateSlug();
      const inserted = await tx
        .insert(projects)
        .values({ id: randomUUID(), userId, slug: candidate, name: "Untitled app", nameSource: "placeholder" })
        .onConflictDoNothing({ target: projects.slug })
        .returning({ id: projects.id, slug: projects.slug });
      if (inserted[0]) {
        projectId = inserted[0].id;
        slug = inserted[0].slug;
      }
    }
    if (!projectId || !slug) {
      throw new Error("Could not allocate a project slug"); // rolls back — no debit
    }

    await reserveDailyBuild(statement => tx.execute(statement));
    const buildId = randomUUID();
    await tx.insert(builds).values({
      id: buildId,
      projectId,
      userId,
      prompt,
      attachments: attachments.length > 0 ? attachments : null,
      ...execution,
      pricingQuoteId: quote?.id ?? null,
      pricingSnapshot: quote?.snapshot ?? null,
      status: "queued",
    });
    if (workerBuildsEnabled()) await tx.execute(sql`
      insert into build_worker_jobs(build_id,workspace_key)
      select id,'project:'||project_id from builds where id=${buildId}
    `);
    if (quote) await recordQuoteAcceptance(tx, userId, buildId, quote);
    if (chargeCredit && !quote) {
      await tx
        .insert(creditEvents)
        .values({
          id: randomUUID(),
          userId,
          delta: -1,
          reason: "build_debit",
          buildId,
          idempotencyKey: `build_debit:${buildId}`,
        })
        .onConflictDoNothing({ target: creditEvents.idempotencyKey });
    }

    return { buildId, slug, projectId, ...execution };
  });
}
