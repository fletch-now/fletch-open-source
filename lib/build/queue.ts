import { BUILD_WORKER_HEALTH_KEY, parseWorkerAvailability } from "./worker-health";
import { BUILD_MAINTENANCE_KEY, parseBuildMaintenance } from "./maintenance";
import { BUILD_CAPACITY_KEY, BUILD_CLAIM_LOCK, parseCapacity, parseCapacitySetting } from "./capacity";
import { settlePricingWith } from "./pricing-budget";
import { STOP_REQUESTED } from "@/lib/build/cancellation";
import { randomUUID } from "node:crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { isProviderId } from "@/lib/agent/selection";
import type { BuildQueueState, QueuedBuildDraft } from "@/lib/build/queue-types";

// Retained as the legacy process fill bound; PostgreSQL remains authoritative.
export function buildCapacity(value = process.env.FORGE_MAX_CONCURRENT_BUILDS): number {
  return value === undefined ? 2 : parseCapacity(value);
}

export const ACTIVE_BUILD_STATUSES = ["provisioning", "building", "compiling"] as const;
const CLAIM_LOCK = BUILD_CLAIM_LOCK;

type Database = typeof db;
export type QueuedClaim = typeof builds.$inferSelect;

export async function claimNextBuild(database: Database = db): Promise<QueuedClaim | null> {
  return database.transaction(async function claim(tx) {
    // Every scheduler uses the same lock and counts database state, so concurrent
    // request handlers cannot overclaim even before their local run maps exist.
    await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK})`);
    const maintenance = await tx.execute(sql`select 1 from app_settings where key=${BUILD_MAINTENANCE_KEY}`);
    if (maintenance.rows.length) return null;
    const setting = await tx.execute<{ value: string }>(sql`select value from app_settings where key=${BUILD_CAPACITY_KEY}`);
    // Elevated capacity is supported only by the independent worker and its slice.
    const policy = parseCapacitySetting(setting.rows[0]?.value);
    if (policy?.version === 2) return null;
    const capacity = Math.min(2, buildCapacity(), policy?.capacity ?? 2);
    const [active] = await tx.select({ value: count() }).from(builds)
      .where(inArray(builds.status, [...ACTIVE_BUILD_STATUSES]));
    if (active.value >= capacity) return null;
    const [next] = await tx.select().from(builds).where(and(eq(builds.status, "queued"),
      sql`not exists (select 1 from build_worker_jobs j where j.build_id=${builds.id})`,
      sql`not exists (select 1 from builds active where active.project_id=${builds.projectId} and active.status in ('provisioning','building','compiling','paused'))`))
      .orderBy(asc(builds.createdAt), asc(builds.id)).limit(1).for("update");
    if (!next) return null;
    const [claimed] = await tx.update(builds).set({ status: "building", startedAt: new Date() })
      .where(and(eq(builds.id, next.id), eq(builds.status, "queued"))).returning();
    return claimed ?? null;
  });
}

export async function readBuildQueue(buildId: string, database: Database = db): Promise<BuildQueueState | null> {
  // One statement gives a consistent status/order/count snapshot.
  // Paused or expired worker ownership reserves capacity until reconciliation.
  const result = await database.execute<{ ahead: string; running: string; reserved: string; capacity_setting: string | null; maintenance_setting: string | null; worker_health: string | null }>(sql`
    with slots as (
      select (j.build_id is null and r.status <> 'paused') or coalesce(j.state='running' and j.owner_id is not null
        and j.lease_expires_at > statement_timestamp(), false) as executing
      from builds r left join build_worker_jobs j on j.build_id=r.id
      where j.state in ('running','recovery_required','paused_budget')
        or (j.build_id is null and r.status in ('provisioning','building','compiling','paused'))
    )
    select
      (select count(*) from builds q where q.status = 'queued'
        and (q.created_at, q.id) < (b.created_at, b.id)) as ahead,
      (select count(*) from slots where executing) as running,
      (select count(*) from slots where not executing) as reserved,
      (select value from app_settings where key=${BUILD_CAPACITY_KEY}) as capacity_setting,
      (select value from app_settings where key=${BUILD_MAINTENANCE_KEY}) as maintenance_setting,
      (select value from app_settings where key=${BUILD_WORKER_HEALTH_KEY}) as worker_health
    from builds b where b.id = ${buildId} and b.status = 'queued'
  `);
  const row = result.rows[0];
  if (!row) return null;
  const ahead = Number(row.ahead);
  const maintenance = parseBuildMaintenance(row.maintenance_setting);
  const setting = parseCapacitySetting(row.capacity_setting);
  const worker = parseWorkerAvailability(row.worker_health);
  return { position: ahead + 1, ahead, running: Number(row.running), reserved: Number(row.reserved), capacity: setting?.capacity ?? 2,
    ...(worker ? { worker } : {}),
    ...(setting?.version === 2 ? { memoryManaged: true } : {}), ...(maintenance ? { maintenance } : {}) };
}

function queuedDraft(build: QueuedClaim): QueuedBuildDraft | null {
  const draft: QueuedBuildDraft = {
    prompt: build.prompt, attachments: build.attachments ?? [], projectId: build.projectId,
    selection: { billingMode: "platform" },
  };
  if (build.billingMode === "own_key") {
    if (!build.provider || !isProviderId(build.provider) || !build.model || !build.credentialId || !build.credentialVersion
      || (build.custodyMode !== "hosted" && build.custodyMode !== "gateway")) {
      return null;
    }
    draft.selection = {
      billingMode: "own_key", custodyMode: build.custodyMode, provider: build.provider, model: build.model,
      credentialId: build.credentialId, credentialVersion: build.credentialVersion,
    };
  }
  return draft;
}

export async function cancelQueuedBuild(buildId: string, userId: string, database: Database = db): Promise<{ draft: QueuedBuildDraft | null; refunded: boolean } | null> {
  return database.transaction(async function cancel(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(${CLAIM_LOCK})`);
    const [cancelled] = await tx.update(builds).set({
      status: "failed", finishedAt: new Date(), error: "Cancelled while queued. Any Fletch build debit was refunded.",
    }).where(and(eq(builds.id, buildId), eq(builds.userId, userId), eq(builds.status, "queued"))).returning();
    if (!cancelled) return null;
    await tx.execute(sql`update build_worker_jobs set state='stopped',stop_requested_at=coalesce(stop_requested_at,clock_timestamp()) where build_id=${buildId} and state='queued'`);
    const draft = queuedDraft(cancelled);
    // Keep the status transition and owned-debit refund atomic. A failed refund
    // leaves the row queued, so a retry cannot lose the reserved credit.
    const refunded = await refundOwnedDebit(tx, cancelled, "stopped");
    return { draft, refunded };
  });
}

// Single-web-process startup only: queued work is durable, interrupted execution
// is failed honestly. This is not a distributed worker lease or session recovery.
export async function recoverInterruptedBuilds(database: Database = db): Promise<string[]> {
  return database.transaction(async function recover(tx) {
    const interrupted = await tx.update(builds).set({
      status: "failed", finishedAt: new Date(),
      error: sql`case when ${builds.error} = ${STOP_REQUESTED} then ${STOP_REQUESTED} else ${"The build was interrupted by a server restart. Any Fletch build debit is refunded. Provider usage may still be billed. Your saved workspace is retained."} end`,
    }).where(and(inArray(builds.status, [...ACTIVE_BUILD_STATUSES]),
      sql`not exists (select 1 from build_worker_jobs j where j.build_id=${builds.id})`)).returning({ id: builds.id, userId: builds.userId });
    for (const build of interrupted) {
      await refundOwnedDebit(tx, build);
    }
    return interrupted.map((build) => build.id);
  });
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function refundOwnedDebit(tx: Transaction, build: { id: string; userId: string }, outcome: "failed" | "stopped" = "failed"): Promise<boolean> {
  if (await settlePricingWith(statement => tx.execute(statement), build.id, outcome)) {
    const released = await tx.execute<{ released_credits: number }>(sql`select released_credits from build_pricing_settlements where build_id=${build.id}`);
    return Number(released.rows[0]?.released_credits ?? 0) > 0;
  }
  const refunded = await tx.execute(sql`
    insert into credit_events (id,user_id,delta,reason,build_id,idempotency_key)
    select ${randomUUID()},user_id,-delta,'refund',build_id,${`refund:${build.id}`}
    from credit_events where user_id = ${build.userId} and build_id = ${build.id}
      and idempotency_key = ${`build_debit:${build.id}`} and reason = 'build_debit' and delta < 0
      and not exists (select 1 from builds b where b.id = ${build.id} and b.billing_mode = 'own_key')
    on conflict (idempotency_key) do nothing
    returning id
  `);
  return refunded.rows.length > 0;
}

export async function failClaimedBuild(buildId: string, userId: string, message: string, database: Database = db, options: { preserveStopRequested?: boolean } = {}): Promise<boolean> {
  return database.transaction(async function fail(tx) {
    const [failed] = await tx.update(builds).set({ status: "failed", error: sql`case when ${builds.error} = ${STOP_REQUESTED} then ${STOP_REQUESTED} else ${message} end`, finishedAt: new Date() })
      .where(and(eq(builds.id, buildId), eq(builds.userId, userId), inArray(builds.status, [...ACTIVE_BUILD_STATUSES]),
        options.preserveStopRequested ? sql`${builds.error} is distinct from ${STOP_REQUESTED}` : undefined,
        sql`not exists (select 1 from build_worker_jobs j where j.build_id=${builds.id})`))
      .returning({ id: builds.id, userId: builds.userId });
    if (failed) await refundOwnedDebit(tx, failed);
    return Boolean(failed);
  });
}

export async function requestBuildStop(buildId: string, userId: string, database: Database = db): Promise<boolean> {
  const [updated] = await database.update(builds).set({ error: STOP_REQUESTED })
    .where(and(eq(builds.id, buildId), eq(builds.userId, userId), inArray(builds.status, [...ACTIVE_BUILD_STATUSES, "paused"])))
    .returning({ id: builds.id });
  return Boolean(updated);
}

export async function finishBuildSuccessfully(buildId: string, database: Database = db): Promise<boolean> {
  const [updated] = await database.update(builds).set({ status: "succeeded", finishedAt: new Date() })
    .where(and(eq(builds.id, buildId), eq(builds.status, "building"), sql`${builds.error} is distinct from ${STOP_REQUESTED}`))
    .returning({ id: builds.id });
  return Boolean(updated);
}
