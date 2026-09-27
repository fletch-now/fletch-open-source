import "server-only";
import type { Pool } from "pg";
import { pool } from "@/lib/db";
import type { ProviderId } from "@/lib/agent/selection";
import { estimateBuildDuration, type BuildDurationEstimate } from "@/lib/build/duration";

const cache = new Map<string, { expiresAt: number; result: Promise<BuildDurationEstimate | null> }>();

export async function recentBuildDuration(provider: ProviderId, model: string | null, needsContract: boolean | null): Promise<BuildDurationEstimate | null> {
  const key = JSON.stringify([provider, model, needsContract]);
  const saved = cache.get(key);
  if (saved && saved.expiresAt > Date.now()) return saved.result;
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  const result = readBuildDurationHistory(provider, model, needsContract);
  cache.set(key, { expiresAt: Date.now() + 60_000, result });
  try { return await result; }
  catch (error) { cache.delete(key); throw error; }
}

export async function readBuildDurationHistory(provider: ProviderId, model: string | null, needsContract: boolean | null, database: Pick<Pool, "query"> = pool): Promise<BuildDurationEstimate | null> {
  const result = await database.query<{ duration_ms: number }>(`
    SELECT extract(epoch FROM (b.finished_at - b.started_at)) * 1000 AS duration_ms
    FROM builds b
    LEFT JOIN build_worker_jobs j ON j.build_id = b.id
    WHERE b.status = 'succeeded' AND b.provider = $1
      AND ($2::text IS NULL OR b.model = $2)
      AND ($3::boolean IS NULL OR b.needs_contract = $3)
      AND b.finished_at > now() - interval '30 days' AND b.finished_at <= now()
      AND b.started_at < b.finished_at
      AND (j.build_id IS NULL OR (j.state = 'completed' AND j.attempt = 1))
    ORDER BY b.finished_at DESC LIMIT 100
  `, [provider, model, needsContract]);
  return estimateBuildDuration(result.rows.map(function milliseconds(row) { return Number(row.duration_ms); }));
}
