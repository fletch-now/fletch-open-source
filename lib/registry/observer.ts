import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, daemonHeartbeats } from "@/lib/db/schema";
import { freshness, type Freshness } from "@/lib/registry/authority/freshness";

export const REGISTRY_OBSERVER_NAME = "registry-observer";

export interface ObservationResult {
  changed: boolean;
  recorded: boolean;
  verdict: Freshness["verdict"];
}

// Observation times belong to the source reading. The observer's own heartbeat
// records successful persistence; neither can advance a registry job's receipt.
export async function recordRegistryObservation(reading: Freshness, name = REGISTRY_OBSERVER_NAME): Promise<ObservationResult> {
  const jobs = reading.jobs.map(function summarize(job) {
    return {
      job: job.job,
      verdict: job.verdict,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      lastOkAt: job.lastOkAt?.toISOString() ?? null,
      metricCoverage: job.metricCoverage ?? null,
      checkpoints: job.checkpoints.map(function checkpoint(point) {
        return { name: point.name, block: point.block.toString(), updatedAt: point.updatedAt.toISOString() };
      }),
    };
  }).sort((left, right) => left.job.localeCompare(right.job));
  const figures = reading.figures.map(function summarize(figure) {
    return { figure: figure.figure, verdict: figure.verdict, newestAt: figure.newestAt?.toISOString() ?? null };
  }).sort((left, right) => left.figure.localeCompare(right.figure));
  const signature = JSON.stringify({
    verdict: reading.verdict,
    daemonAlive: reading.daemon.alive,
    jobs: jobs.map(job => [job.job, job.verdict]),
    figures: figures.map(figure => [figure.figure, figure.verdict]),
  });
  const detail = {
    chainId: reading.chainId,
    checkedAt: reading.checkedAt.toISOString(),
    verdict: reading.verdict,
    signature,
    daemonLastBeatAt: reading.daemon.lastBeatAt?.toISOString() ?? null,
    headReadAt: reading.head?.readAt.toISOString() ?? null,
    jobs,
    figures,
  };
  return db.transaction(async function persist(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${name}))`);
    const [previous] = await tx.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, name)).limit(1);
    const prior = previous?.detail as { checkedAt?: string; signature?: string; verdict?: string } | null;
    // A slower overlapping process must not overwrite a newer observation.
    if (prior?.checkedAt && Date.parse(prior.checkedAt) >= reading.checkedAt.getTime()) {
      return { changed: false, recorded: false, verdict: reading.verdict };
    }
    const changed = prior?.signature !== signature;
    if (changed) {
      await tx.insert(auditLog).values({
        id: `al_${randomUUID()}`,
        userId: null,
        actorType: "system",
        actorId: name,
        action: "registry.observation.changed",
        resourceType: "chain",
        resourceId: String(reading.chainId),
        metadata: { previousVerdict: prior?.verdict ?? null, ...detail },
      });
    }
    await tx.insert(daemonHeartbeats).values({ name, lastBeatAt: sql`now()`, headBlock: reading.head?.block ?? null, detail })
      .onConflictDoUpdate({ target: daemonHeartbeats.name, set: { lastBeatAt: sql`now()`, headBlock: reading.head?.block ?? null, detail } });
    return { changed, recorded: true, verdict: reading.verdict };
  });
}

export async function observeRegistry(chainId: number, read = freshness, name = REGISTRY_OBSERVER_NAME): Promise<ObservationResult> {
  const reading = await read(chainId);
  return recordRegistryObservation(reading, name);
}
