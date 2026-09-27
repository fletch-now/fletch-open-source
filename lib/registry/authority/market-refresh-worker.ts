import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexTokens } from "@/lib/db/schema";
import { getMarketReadClient } from "@/lib/chain/rpc";
import { checkMarketRpcBudget } from "./market-rpc-budget";
import { refreshDexTokens, refreshPoolState } from "./dex";
import { stateReadIsCurrent } from "./dex-state-freshness";
import { tokenReadDue } from "./dex-token-schedule";
import { claimMarketRefresh, finishMarketRefresh, type MarketRefreshClaim } from "./market-refresh";
import type { RunOutcome } from "./runs";

async function refresh(claim: MarketRefreshClaim): Promise<boolean> {
  const client = getMarketReadClient(claim.chainId, () => checkMarketRpcBudget("demand"));
  if (claim.kind === "pool") {
    const where = and(eq(dexPools.chainId, claim.chainId), eq(dexPools.id, claim.target));
    const [before] = await db.select().from(dexPools).where(where);
    if (!before || ("canonical" in before && !before.canonical)) return true;
    if (stateReadIsCurrent(before.stateCheckedAt) && before.priceUsd !== null) return true;
    await refreshPoolState(claim.chainId, { poolIds: [claim.target], client, force: true });
    const [after] = await db.select().from(dexPools).where(where);
    return stateReadIsCurrent(after?.stateCheckedAt);
  }
  const where = and(eq(dexTokens.chainId, claim.chainId), eq(dexTokens.address, claim.target));
  const [before] = await db.select().from(dexTokens).where(where);
  if (before && !("orphaned" in before && before.orphaned) && !tokenReadDue(before, new Date())) return before.error === null;
  await refreshDexTokens(claim.chainId, [claim.target], { client, limit: 1, workMs: 15_000 });
  const [after] = await db.select().from(dexTokens).where(where);
  return Boolean(after && after.error === null && after.bytecodePresent === true && after.decimals !== null && !tokenReadDue(after, new Date()));
}

// One pool and one token per tick. Leases survive daemon restarts, and a later
// claimant fences a timed-out worker from overwriting its result.
export async function processMarketRefreshRequests(chainId: number, read: (claim: MarketRefreshClaim) => Promise<boolean> = refresh): Promise<RunOutcome> {
  let completed = 0;
  let deferred = 0;
  for (const kind of ["token", "pool"] as const) {
    const claim = await claimMarketRefresh(chainId, kind);
    if (!claim) continue;
    let succeeded = false;
    try { succeeded = await read(claim); } catch { /* Persist a sanitized retry below. */ }
    if (await finishMarketRefresh(claim, succeeded)) {
      if (succeeded) completed++;
      else deferred++;
    }
  }
  // Only transient successful requests expire; observations and pending work
  // remain intact. This cannot remove pool/token history.
  await db.execute(sql`delete from market_refresh_requests where chain_id=${chainId} and not pending and completed_at < now()-interval '7 days'`);
  return { rows: completed, detail: { completed, deferred, maxPools: 1, maxTokens: 1 } };
}
