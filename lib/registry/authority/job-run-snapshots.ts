import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { JOB_NAMES } from "./cadence";
import type { LastRun } from "./runs";

interface RunRow {
  job: string;
  started_at: Date | null;
  finished_at: Date | null;
  ok: boolean | null;
  rows: number | null;
  error: string | null;
  success_at: Date | null;
  success_rows: number | null;
  completed_at: Date | null;
  completed_ok: boolean | null;
  completed_error: string | null;
  completed_detail: unknown;
}

// Probe each scheduled job's existing (job, started_at) index. DISTINCT ON
// sorted the entire growing run history three times for every cold reading.
export async function readJobRunSnapshots(database: Pick<Pool, "query"> = pool, names: readonly string[] = JOB_NAMES) {
  const result = await database.query<RunRow>(`select j.job,
      latest.started_at at time zone 'UTC' started_at,latest.finished_at at time zone 'UTC' finished_at,
      latest.ok,latest.rows,latest.error,
      success.finished_at at time zone 'UTC' success_at,success.rows success_rows,
      completed.finished_at at time zone 'UTC' completed_at,completed.ok completed_ok,
      completed.error completed_error,completed.detail completed_detail
    from unnest($1::text[]) j(job)
    left join lateral (select started_at,finished_at,ok,rows,error from sync_runs where job=j.job order by started_at desc limit 1) latest on true
    left join lateral (select finished_at,rows from sync_runs where job=j.job and ok=true order by started_at desc limit 1) success on true
    left join lateral (select finished_at,ok,error,detail from sync_runs where job=j.job and ok is not null order by started_at desc limit 1) completed on true`, [[...names]]);
  const latest = new Map<string, LastRun>();
  const ok = new Map<string, { finishedAt: Date; rows: number | null }>();
  const finished = new Map<string, { ok: boolean; error: string | null; detail: unknown }>();
  for (const row of result.rows) {
    if (row.started_at) latest.set(row.job, { job: row.job, startedAt: row.started_at, finishedAt: row.finished_at, ok: row.ok, rows: row.rows, error: row.error });
    if (row.success_at) ok.set(row.job, { finishedAt: row.success_at, rows: row.success_rows });
    if (row.completed_ok !== null) finished.set(row.job, { ok: row.completed_ok, error: row.completed_error, detail: row.completed_detail });
  }
  return { latest, ok, finished };
}
