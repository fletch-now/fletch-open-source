import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { appSettings } from "@/lib/db/schema";

// Operator settings that outlive a deploy. Read anywhere; written only from
// lib/admin/actions.ts, which records the change in audit_log.

export const DISCOVERY_FLOOR_KEY = "discovery.min_liquidity_usd";
// Dollars of pool depth a discovered token needs before it appears in default
// listings. Below it the token is still stored, still resolvable by address,
// and still watchable — a launchpad makes thousands of empty pools a week and
// none of them belongs at the top of a market table.
export const DISCOVERY_FLOOR_DEFAULT = 100;

export async function readSetting(key: string): Promise<string | null> {
  const rows = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function writeSetting(key: string, value: string, updatedBy: string): Promise<void> {
  if (key.startsWith("build.pricing.")) throw new Error("Pricing settings require the audited pricing workflow.");
  if (key.startsWith("credits.fltx.")) throw new Error("Holder rewards require the audited holder-credit workflow.");
  await db
    .insert(appSettings)
    .values({ key, value, updatedBy })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: new Date() } });
}

export async function discoveryFloorUsd(): Promise<number> {
  return numberSetting(DISCOVERY_FLOOR_KEY, DISCOVERY_FLOOR_DEFAULT);
}

export const PRICE_FLOOR_KEY = "markets.price_floor_usd";
// Dollars of quote-side depth a pool needs before its price is worth showing.
// A pool holding sixty dollars can print any price its deployer likes by
// trading against itself; below this, price, change, FDV and market cap are
// figures nobody could act on, so they read as "—".
export const PRICE_FLOOR_DEFAULT = 100;

export async function priceFloorUsd(): Promise<number> {
  return numberSetting(PRICE_FLOOR_KEY, PRICE_FLOOR_DEFAULT);
}

async function numberSetting(key: string, fallback: number): Promise<number> {
  const value = await readSetting(key);
  if (value === null || value.trim() === "") {
    return fallback;
  }
  const stored = Number(value);
  return Number.isFinite(stored) && stored >= 0 ? stored : fallback;
}
