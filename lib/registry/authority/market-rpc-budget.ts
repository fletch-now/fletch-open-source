import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkRpcBudget } from "@/lib/ratelimit";

export const MARKET_STATE_RPC_DAY = 120_000;
export const MARKET_DEMAND_RPC_DAY = 4_000;

// Both lanes consume the global budget too. An unavailable database fails
// closed, and denied reads never enter the provider transport.
export async function checkMarketRpcBudget(lane: "state" | "demand"): Promise<{ ok: boolean }> {
  try {
    const bucket = `rpc:market-${lane}:day`;
    const result = await db.execute<{ count: number }>(sql`
      insert into rate_counters(bucket,count,window_start) values(${bucket},1,now())
      on conflict(bucket) do update set
        count=case when rate_counters.window_start <= now()-interval '1 day' then 1 else rate_counters.count+1 end,
        window_start=case when rate_counters.window_start <= now()-interval '1 day' then now() else rate_counters.window_start end
      returning count`);
    if (result.rows[0].count > (lane === "state" ? MARKET_STATE_RPC_DAY : MARKET_DEMAND_RPC_DAY)) return { ok: false };
    return checkRpcBudget();
  } catch { return { ok: false }; }
}
