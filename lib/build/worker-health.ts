import { statfs } from "node:fs/promises";
import type { Pool } from "pg";

export const BUILD_WORKER_HEALTH_KEY = "build.worker.health";
export interface WorkerAvailability {
  state: "ready" | "capacity_wait" | "offline";
  checkedAt: string;
}

export function parseWorkerAvailability(value: string | null, now = Date.now()): WorkerAvailability | undefined {
  if (!value) return undefined;
  try {
    const row = JSON.parse(value) as Record<string, unknown>;
    if (typeof row.checkedAt !== "string" || !Number.isFinite(Date.parse(row.checkedAt))) return undefined;
    if (Date.parse(row.checkedAt) > now + 5000 || now - Date.parse(row.checkedAt) > 15_000) return { state: "offline", checkedAt: row.checkedAt };
    return { state: row.ready === true ? "ready" : "capacity_wait", checkedAt: row.checkedAt };
  } catch { return undefined; }
}

export async function writeWorkerHealth(pool: Pool, ownerId: string, ready: boolean, active: number): Promise<void> {
  const value = JSON.stringify({ ownerId, ready, active, checkedAt: new Date().toISOString() });
  await pool.query("insert into app_settings(key,value) values($1,$2) on conflict(key) do update set value=excluded.value,updated_at=now()", [BUILD_WORKER_HEALTH_KEY, value]);
}

export async function storageAdmissionReady(root: string): Promise<boolean> {
  try {
    const stats = await statfs(root);
    return stats.bavail * stats.bsize >= 15 * 1024 ** 3 && stats.ffree >= 100_000;
  } catch { return false; }
}
