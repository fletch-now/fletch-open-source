import type { Pool } from "pg";
import { pool } from "@/lib/db";
import type { ScoutingCoverage } from "./scouting";
import type { SwapIndexerReading } from "./authority/market-swap-status";

export interface CoverageReceipt {
  version: 1;
  measuredAt: string;
  scouting: ScoutingCoverage;
  swapIndexer: Pick<SwapIndexerReading, "checkedAt" | "tiers" | "historicalUsdAvailable">;
}

export async function readCoverageReceipt(chainId: number, database: Pick<Pool, "query"> = pool): Promise<CoverageReceipt | null> {
  const result = await database.query<{ value: string }>("select value from app_settings where key=$1", [`registry.coverage:${chainId}`]);
  if (!result.rows[0]) return null;
  try {
    const value = JSON.parse(result.rows[0].value) as CoverageReceipt;
    if (value.version !== 1 || !Number.isFinite(Date.parse(value.measuredAt))
      || !Number.isFinite(Date.parse(value.scouting?.measuredAt))
      || !Number.isFinite(Date.parse(value.swapIndexer?.checkedAt)) || !Array.isArray(value.swapIndexer?.tiers)) return null;
    return value;
  } catch { return null; }
}

export function coverageReceiptStatus(at: string | null | undefined, now = Date.now()): "current" | "stale" | "unavailable" {
  if (!at || !Number.isFinite(Date.parse(at))) return "unavailable";
  const age = now - Date.parse(at);
  return age >= 0 && age <= 120_000 ? "current" : "stale";
}

export async function writeCoverageReceipt(chainId: number, reading: CoverageReceipt, database: Pick<Pool, "query"> = pool): Promise<void> {
  await database.query(`insert into app_settings(key,value) values($1,$2)
    on conflict(key) do update set value=excluded.value,updated_at=now()
    where app_settings.value::jsonb->>'measuredAt' <= excluded.value::jsonb->>'measuredAt'`, [`registry.coverage:${chainId}`, JSON.stringify(reading)]);
}
