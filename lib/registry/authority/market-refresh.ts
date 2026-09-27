import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexPools, dexTokens, registryAssets } from "@/lib/db/schema";
import { stateReadIsCurrent } from "./dex-state-freshness";
import { tokenReadDue } from "./dex-token-schedule";
import { stateRetryIsDue } from "./dex-state-retry";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_TARGETS = 4;
const MAX_PENDING = 5_000;
export const MARKET_REFRESH_PER_IP_MINUTE = 12;
export const MARKET_REFRESH_GLOBAL_MINUTE = 60;
export const MARKET_REFRESH_GLOBAL_DAY = 5_000;

// The isolated release intentionally predates the discovery reorg migration.
// Use its actual schema while retaining canonical guards in the full tree.
const canonicalPool = "canonical" in dexPools ? sql`dex_pools.canonical = true` : sql`true`;

export interface RefreshTargets { poolIds?: readonly string[]; tokenAddresses?: readonly string[] }
export interface RefreshAdmission { queued: number; reason: "queued" | "current" | "rate_limited" | "unavailable" }
interface Candidate { kind: "pool" | "token"; target: string; priority: string }

function addresses(values: readonly string[] = []): string[] {
  return [...new Set(values.map((value) => value.toLowerCase()).filter((value) => ADDRESS.test(value)))].slice(0, MAX_TARGETS);
}

export async function enqueueMarketRefresh(chainId: number, input: RefreshTargets, ip: string): Promise<RefreshAdmission> {
  if (!isIP(ip)) return { queued: 0, reason: "rate_limited" };
  try {
    const now = new Date();
    const poolIds = [...new Set(input.poolIds ?? [])].filter((id) => id.length <= 100).slice(0, MAX_TARGETS);
    const pools = poolIds.length ? await db.select().from(dexPools).where(and(eq(dexPools.chainId, chainId), canonicalPool, inArray(dexPools.id, poolIds))) : [];
    const tokens = addresses([...(input.tokenAddresses ?? []), ...pools.map((pool) => pool.tokenAddress).filter((value): value is string => value !== null)]);
    const known = tokens.length ? await db.select().from(dexTokens).where(and(eq(dexTokens.chainId, chainId), inArray(dexTokens.address, tokens))) : [];
    const candidates: Candidate[] = pools.filter(function due(pool) {
      if (!stateRetryIsDue(pool.stateRetryAt, now)) return false;
      const token = known.find((row) => row.address === pool.tokenAddress);
      const missingPricingMetadata = pool.priceUsd === null && pool.tokenAddress !== null && (!token || tokenReadDue(token, now));
      return !stateReadIsCurrent(pool.stateCheckedAt, now.getTime()) || missingPricingMetadata;
    }).map((pool) => ({ kind: "pool", target: pool.id, priority: pool.depthUsd ?? "0" }));
    const listed = tokens.length ? await db.select({ address: registryAssets.address }).from(registryAssets).where(and(eq(registryAssets.chainId, chainId), inArray(registryAssets.address, tokens))) : [];
    const listedAddresses = new Set(listed.map((row) => row.address.toLowerCase()));
    for (const target of tokens) {
      if (listedAddresses.has(target)) continue;
      const token = known.find((row) => row.address === target);
      if (token && !("orphaned" in token && token.orphaned) && !tokenReadDue(token, now)) continue;
      const depth = pools.filter((pool) => pool.tokenAddress === target).reduce((maximum, pool) => Math.max(maximum, Number(pool.depthUsd ?? 0)), 0);
      candidates.push({ kind: "token", target, priority: String(depth) });
    }
    if (!candidates.length) return { queued: 0, reason: "current" };
    return await db.transaction(async function admit(tx) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('market-refresh-admission'))`);
      const candidateIds = candidates.map((entry) => `${chainId}:${entry.kind}:${entry.target}`);
      const waiting = await tx.execute<{ id: string }>(sql`select id from market_refresh_requests
        where id=any(${sql.param(candidateIds)}::text[]) and (pending or next_attempt_at>now())`);
      const waitingIds = new Set(waiting.rows.map((row) => row.id));
      const eligible = candidates.filter((entry) => !waitingIds.has(`${chainId}:${entry.kind}:${entry.target}`));
      if (!eligible.length) return { queued: 0, reason: "queued" as const };
      // Existing pending/backed-off work consumes no additional queue slot or
      // contract read; a page view never resets an unsuccessful attempt.
      const pending = await tx.execute<{ count: number }>(sql`select count(*)::integer as count from market_refresh_requests where pending`);
      if (pending.rows[0].count >= MAX_PENDING) return { queued: 0, reason: "rate_limited" as const };
      const buckets = [
        { key: `market-refresh:ip:${createHash("sha256").update(ip).digest("hex")}`, seconds: 60, limit: MARKET_REFRESH_PER_IP_MINUTE },
        { key: "market-refresh:global:minute", seconds: 60, limit: MARKET_REFRESH_GLOBAL_MINUTE },
        { key: "market-refresh:global:day", seconds: 86_400, limit: MARKET_REFRESH_GLOBAL_DAY },
      ];
      for (const bucket of buckets) {
        const result = await tx.execute<{ count: number }>(sql`
          insert into rate_counters(bucket,count,window_start) values(${bucket.key},1,now())
          on conflict(bucket) do update set
            count=case when rate_counters.window_start <= now()-${bucket.seconds}*interval '1 second' then 1 else rate_counters.count+1 end,
            window_start=case when rate_counters.window_start <= now()-${bucket.seconds}*interval '1 second' then now() else rate_counters.window_start end
          returning count`);
        if (result.rows[0].count > bucket.limit) return { queued: 0, reason: "rate_limited" as const };
      }
      let queued = 0;
      for (const candidate of eligible.slice(0, Math.max(0, MAX_PENDING - pending.rows[0].count))) {
        const id = `${chainId}:${candidate.kind}:${candidate.target}`;
        const result = await tx.execute(sql`
          insert into market_refresh_requests(id,chain_id,kind,target,priority) values(${id},${chainId},${candidate.kind},${candidate.target},${candidate.priority})
          on conflict(id) do update set pending=true,requested_at=now(),priority=excluded.priority
          where not market_refresh_requests.pending and market_refresh_requests.next_attempt_at <= now()
          returning id`);
        queued += result.rows.length;
        if (candidate.kind === "token" && result.rows.length) {
          // A pasted address is a request, not proof of a token's identity.
          await tx.insert(dexTokens).values({ id: `${chainId}:${candidate.target}`, chainId, address: candidate.target, source: "user_submitted" }).onConflictDoNothing();
        }
      }
      return { queued, reason: "queued" as const };
    });
  } catch { return { queued: 0, reason: "unavailable" }; }
}

export async function enqueueMarketSearch(chainId: number, query: string, ip: string): Promise<RefreshAdmission> {
  const q = query.trim().replace(/^\$/, "").toLowerCase().slice(0, 128);
  if (!q || !isIP(ip)) return { queued: 0, reason: "current" };
  try {
    const exactAddress = ADDRESS.test(q);
    const prefix = `${q.replace(/[\\%_]/g, "\\$&")}%`;
    let matches = or(ilike(dexTokens.symbol, prefix), ilike(dexTokens.name, prefix));
    if (exactAddress) matches = or(eq(dexPools.currency0, q), eq(dexPools.currency1, q), eq(dexPools.poolAddress, q));
    if (/^0x[0-9a-f]{64}$/.test(q)) matches = eq(dexPools.id, q);
    const pools = await db.select({ id: dexPools.id, tokenAddress: dexPools.tokenAddress, poolAddress: dexPools.poolAddress }).from(dexPools)
      .leftJoin(dexTokens, and(eq(dexTokens.chainId, chainId), eq(dexTokens.address, dexPools.tokenAddress)))
      .where(and(eq(dexPools.chainId, chainId), canonicalPool, matches))
      .orderBy(sql`${dexPools.depthUsd} desc nulls last`, dexPools.id).limit(MAX_TARGETS);
    const tokenAddresses = pools.map((pool) => pool.tokenAddress).filter((value): value is string => value !== null);
    if (exactAddress && !pools.some((pool) => pool.poolAddress === q)) tokenAddresses.unshift(q);
    return enqueueMarketRefresh(chainId, { poolIds: pools.map((pool) => pool.id), tokenAddresses }, ip);
  } catch { return { queued: 0, reason: "unavailable" }; }
}

export interface MarketRefreshClaim { id: string; chainId: number; kind: "pool" | "token"; target: string; token: string; attempts: number }

export async function claimMarketRefresh(chainId: number, kind: "pool" | "token"): Promise<MarketRefreshClaim | null> {
  const token = randomUUID();
  const result = await db.execute<{ id: string; target: string; attempts: number }>(sql`
    with candidate as (
      select id from market_refresh_requests where chain_id=${chainId} and kind=${kind} and pending
        and next_attempt_at <= now() and (lease_until is null or lease_until < now())
      order by priority desc,requested_at,id for update skip locked limit 1
    ) update market_refresh_requests as request set lease_token=${token},lease_until=now()+interval '2 minutes'
      from candidate where request.id=candidate.id returning request.id,request.target,request.attempts`);
  const row = result.rows[0];
  return row ? { ...row, chainId, kind, token } : null;
}

export function refreshRetryMs(attempts: number): number {
  return Math.min(3_600_000, 60_000 * 2 ** Math.min(6, Math.max(0, attempts)));
}

export async function finishMarketRefresh(claim: MarketRefreshClaim, succeeded: boolean): Promise<boolean> {
  const retryMs = succeeded ? 0 : refreshRetryMs(claim.attempts);
  const result = await db.execute(sql`
    update market_refresh_requests set pending=${!succeeded},lease_token=null,lease_until=null,
      attempts=${succeeded ? 0 : claim.attempts + 1},next_attempt_at=now()+${retryMs}*interval '1 millisecond',
      completed_at=case when ${succeeded} then now() else completed_at end,
      last_error=${succeeded ? null : `${claim.kind}_read_unavailable`}
    where id=${claim.id} and lease_token=${claim.token} returning id`);
  return result.rows.length === 1;
}
