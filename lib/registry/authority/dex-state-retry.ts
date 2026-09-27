import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools } from "@/lib/db/schema";

export const STATE_RETRY_MIN_MS = 60_000;
export const STATE_RETRY_MAX_MS = 60 * 60_000;

export function stateRetryIsDue(at: Date | null | undefined, now = new Date()): boolean {
  if (!at) return true;
  const wait = at.getTime() - now.getTime();
  return !Number.isFinite(wait) || wait <= 0 || wait > STATE_RETRY_MAX_MS;
}

// A failed read is an attempt, never a new observation. Persist the delay so
// a restart or repeated page view cannot immediately spend the same RPC again.
export async function deferPoolStateReads(chainId: number, ids: readonly string[], now = new Date()): Promise<void> {
  if (!ids.length) return;
  await db.update(dexPools).set({
    stateAttemptedAt: now,
    stateFailures: sql`least(${dexPools.stateFailures}+1, 20)`,
    stateRetryAt: sql`${now.toISOString()}::timestamp + least(${STATE_RETRY_MAX_MS}, ${STATE_RETRY_MIN_MS} * power(2, least(${dexPools.stateFailures}, 6))) * interval '1 millisecond'`,
  }).where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true), inArray(dexPools.id, [...ids])));
}
