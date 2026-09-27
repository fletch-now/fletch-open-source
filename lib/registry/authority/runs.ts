// Bookkeeping shared by every pipeline: a run record per job, and a block
// checkpoint per log scanner. No "server-only": workers/registry.ts imports this.

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { chainHealth, syncCheckpoints, syncRuns, syncCheckpointHistory } from "@/lib/db/schema";
import { logEvent } from "@/lib/log";
import { redactSecrets } from "@/lib/redact";

export interface RunOutcome {
  rows: number;
  detail?: Record<string, unknown>;
  // A partial pass can retain its measurements while reporting failed reads.
  error?: string;
}

// Wraps a job so its start, end, row count and error are on record whatever
// happens inside. The job's own exception is logged and swallowed here: one
// failed run must not stop the loop that scheduled it.
export async function recordRun(job: string, work: () => Promise<RunOutcome>): Promise<RunOutcome | null> {
  const id = randomUUID();
  const startedAt = new Date();
  await db.insert(syncRuns).values({ id, job, startedAt });
  try {
    const outcome = await work();
    const error = outcome.error ? redactSecrets(outcome.error).slice(0, 500) : null;
    await db
      .update(syncRuns)
      .set({ finishedAt: new Date(), ok: error === null, error, rows: outcome.rows, detail: outcome.detail ?? null })
      .where(eq(syncRuns.id, id));
    logEvent("registry", { ...outcome.detail, event: error ? "run-failed" : "run", job, ok: error === null, error, rows: outcome.rows, ms: Date.now() - startedAt.getTime() });
    return error ? null : outcome;
  } catch (cause) {
    const error = redactSecrets(cause instanceof Error ? cause.message : String(cause));
    await db.update(syncRuns).set({ finishedAt: new Date(), ok: false, error: error.slice(0, 500) }).where(eq(syncRuns.id, id));
    logEvent("registry", { event: "run-failed", job, error: error.slice(0, 300), ms: Date.now() - startedAt.getTime() });
    return null;
  }
}

export interface Checkpoint {
  blockNumber: bigint;
  blockHash: string;
}

export async function readCheckpoint(name: string): Promise<Checkpoint | null> {
  const rows = await db.select().from(syncCheckpoints).where(eq(syncCheckpoints.name, name)).limit(1);
  const row = rows[0];
  return row ? { blockNumber: row.blockNumber, blockHash: row.blockHash } : null;
}

// A transaction or the pool: a scanner that commits a window's rows and its
// checkpoint together passes its transaction so neither can land alone.
export type Executor = Pick<typeof db, "insert" | "update" | "select" | "delete">;

export async function writeCheckpoint(name: string, chainId: number, checkpoint: Checkpoint, executor: Executor = db): Promise<void> {
  await executor
    .insert(syncCheckpoints)
    .values({ name, chainId, blockNumber: checkpoint.blockNumber, blockHash: checkpoint.blockHash, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: syncCheckpoints.name,
      set: { blockNumber: checkpoint.blockNumber, blockHash: checkpoint.blockHash, updatedAt: sql`now()` },
    });
  // Per-asset coverage markers are not progress; every other checkpoint is.
  if (!name.includes("-asset:")) {
    await executor.insert(syncCheckpointHistory).values({ id: randomUUID(), name, blockNumber: checkpoint.blockNumber });
    await executor.delete(syncCheckpointHistory).where(and(eq(syncCheckpointHistory.name, name), lt(syncCheckpointHistory.at, sql`now() - interval '2 days'`)));
  }
}

export interface CheckpointSample {
  blockNumber: bigint;
  at: Date;
}

// One query for all scanners in a status reading, oldest first per scanner.
export async function checkpointSamples(names: string[], since: Date): Promise<Map<string, CheckpointSample[]>> {
  const samples = new Map<string, CheckpointSample[]>();
  if (names.length === 0) return samples;
  const rows = await db
    .select({ name: syncCheckpointHistory.name, blockNumber: syncCheckpointHistory.blockNumber, at: syncCheckpointHistory.at })
    .from(syncCheckpointHistory)
    .where(and(inArray(syncCheckpointHistory.name, names), gte(syncCheckpointHistory.at, since)))
    .orderBy(syncCheckpointHistory.at);
  for (const row of rows) {
    const entries = samples.get(row.name) ?? [];
    entries.push({ blockNumber: row.blockNumber, at: row.at });
    samples.set(row.name, entries);
  }
  return samples;
}

export interface LastRun {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  ok: boolean | null;
  rows: number | null;
  error: string | null;
}

// The most recent run of every job, for the ops report and the System page.
export async function lastRuns(): Promise<LastRun[]> {
  const rows = await db
    .selectDistinctOn([syncRuns.job], {
      job: syncRuns.job,
      startedAt: syncRuns.startedAt,
      finishedAt: syncRuns.finishedAt,
      ok: syncRuns.ok,
      rows: syncRuns.rows,
      error: syncRuns.error,
    })
    .from(syncRuns)
    .orderBy(syncRuns.job, desc(syncRuns.startedAt));
  return rows;
}

// The latest finished run of one job, or null if it has never run: pages use
// it to tell "nothing found" from "not looked yet".
export async function lastRunOf(job: string): Promise<{ ok: boolean | null; finishedAt: Date | null } | null> {
  const rows = await db
    .select({ ok: syncRuns.ok, finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(eq(syncRuns.job, job))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export interface RecordedHead {
  block: bigint;
  at: Date;
}

// Head as the chain-health job last recorded it, with when it read it. From
// the database rather than the RPC because the callers are page renders, which
// must not wait on a network call to say how far a scanner trails the chain —
// and a caller that publishes the number needs its age to go with it.
// A head read minutes ago is a head; an older one says nothing about how far
// behind a scanner is now, so it is reported as no head at all.
const HEAD_FRESH_MS = 5 * 60_000;

export async function recordedHead(chainId: number): Promise<RecordedHead | null> {
  const rows = await db
    .select({ block: chainHealth.headBlock, at: chainHealth.checkedAt })
    .from(chainHealth)
    .where(eq(chainHealth.chainId, chainId))
    .orderBy(desc(chainHealth.checkedAt))
    .limit(1);
  const row = rows[0];
  if (!row || Date.now() - row.at.getTime() > HEAD_FRESH_MS) {
    return null;
  }
  return row;
}

// The latest run that finished, whatever its verdict, and the latest that
// finished well. Inside a job, lastRunOf returns the run in progress, so an
// "announce only after a completed pass" guard must use one of these.
export async function lastFinishedRunOf(job: string): Promise<{ ok: boolean; finishedAt: Date | null; error: string | null } | null> {
  const rows = await db
    .select({ ok: syncRuns.ok, finishedAt: syncRuns.finishedAt, error: syncRuns.error })
    .from(syncRuns)
    .where(and(eq(syncRuns.job, job), isNotNull(syncRuns.ok)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  const row = rows[0];
  return row ? { ok: row.ok === true, finishedAt: row.finishedAt, error: row.error } : null;
}

export async function lastOkRunOf(job: string): Promise<{ finishedAt: Date | null } | null> {
  const rows = await db
    .select({ finishedAt: syncRuns.finishedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.job, job), eq(syncRuns.ok, true)))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  return rows[0] ?? null;
}
