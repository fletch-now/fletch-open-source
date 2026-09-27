import type { Pool } from "pg";

export const BUILD_MAINTENANCE_KEY = "build.maintenance";

export interface BuildMaintenanceRecord {
  version: 1;
  operationId: string;
  phase: "draining" | "updating";
  startedAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface BuildMaintenanceSnapshot {
  phase: "draining" | "updating";
  startedAt: string | null;
  heartbeatAt: string | null;
  expiresAt: string | null;
  stale: boolean;
}

export function parseBuildMaintenance(value: unknown, now = Date.now()): BuildMaintenanceSnapshot | null {
  if (value === undefined || value === null) return null;
  let record: unknown = value;
  if (typeof value === "string") {
    try { record = JSON.parse(value); } catch { record = null; }
  }
  const held: BuildMaintenanceSnapshot = { phase: "updating", startedAt: null, heartbeatAt: null, expiresAt: null, stale: true };
  if (!record || typeof record !== "object" || Array.isArray(record)) return held;
  const row = record as Record<string, unknown>;
  if (row.version !== 1 || typeof row.operationId !== "string" || !row.operationId.trim()
    || row.operationId.length > 128 || (row.phase !== "draining" && row.phase !== "updating")) return held;
  const dates = [row.startedAt, row.heartbeatAt, row.expiresAt];
  if (dates.some(value => typeof value !== "string" || !Number.isFinite(Date.parse(value)))) return held;
  const [started, heartbeat, expires] = dates.map(value => Date.parse(value as string));
  return {
    phase: row.phase, startedAt: row.startedAt as string, heartbeatAt: row.heartbeatAt as string, expiresAt: row.expiresAt as string,
    stale: !Number.isFinite(now) || started > now || heartbeat > now || heartbeat < started || expires <= heartbeat || expires <= now,
  };
}

export async function readBuildMaintenance(client: Pick<Pool, "query">): Promise<BuildMaintenanceSnapshot | null> {
  const result = await client.query<{ value: string }>("select value from app_settings where key=$1", [BUILD_MAINTENANCE_KEY]);
  return parseBuildMaintenance(result.rows[0]?.value);
}
