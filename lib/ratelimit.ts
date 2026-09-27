import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { WATCH_LIMITS } from "@/lib/watch/types";

// Counters live in Postgres, not in this process. In memory they reset on every
// deploy and every crash, and a second replica would have doubled every ceiling —
// including the daily one that bounds how much model spend a bad day can cause.
//
// One statement per check: an upsert that resets the window when it has expired
// and returns the post-increment count, so two concurrent requests cannot both
// read the same pre-increment value.

const PER_USER_HOUR = Number(process.env.FORGE_BUILDS_PER_USER_HOUR ?? 10);
const PER_IP_HOUR = Number(process.env.FORGE_BUILDS_PER_IP_HOUR ?? 20);
const GLOBAL_PER_DAY = Number(process.env.FORGE_BUILDS_GLOBAL_DAY ?? 500);

// Prompt enhancement is free, so it gets its own, tighter bucket rather than
// eating into the build allowance.
const ENHANCE_PER_USER_HOUR = 30;

export interface RateVerdict {
  ok: boolean;
  reason?: string;
  // On a refusal, how many seconds until the window resets and a retry can pass.
  retryAfterSeconds?: number;
}

interface Bumped {
  count: number;
  // Seconds until this bucket's window ends, so a refusal can say when to retry.
  resetInSeconds: number;
}

type CounterExecutor = (statement: SQL) => Promise<{ rows: unknown[] }>;

async function bump(bucket: string, windowSeconds: number, execute: CounterExecutor = statement => db.execute(statement)): Promise<Bumped> {
  const rows = await execute(sql`
    INSERT INTO rate_counters (bucket, count, window_start)
    VALUES (${bucket}, 1, now())
    ON CONFLICT (bucket) DO UPDATE SET
      count = CASE
        WHEN rate_counters.window_start < now() - (${windowSeconds} * interval '1 second')
        THEN 1
        ELSE rate_counters.count + 1
      END,
      window_start = CASE
        WHEN rate_counters.window_start < now() - (${windowSeconds} * interval '1 second')
        THEN now()
        ELSE rate_counters.window_start
      END
    RETURNING count, ceil(extract(epoch from (window_start + (${windowSeconds} * interval '1 second') - now()))) AS reset_in
  `);
  const row = rows.rows?.[0] as { count?: number; reset_in?: number | string } | undefined;
  return { count: Number(row?.count ?? 0), resetInSeconds: Math.max(1, Number(row?.reset_in ?? windowSeconds)) };
}

// A limiter that cannot reach its store must not become an open door.
async function bumpOrDeny(bucket: string, windowSeconds: number): Promise<Bumped> {
  return bump(bucket, windowSeconds).catch(function unavailable() {
    return { count: Number.POSITIVE_INFINITY, resetInSeconds: windowSeconds };
  });
}

function verdict(bumped: Bumped, limit: number, reason: string): RateVerdict {
  if (bumped.count > limit) {
    return { ok: false, reason, retryAfterSeconds: bumped.resetInSeconds };
  }
  return { ok: true };
}

// Registry reads are public: the data is the point, and an agent fetching it
// should not need an account. Per address, per minute, generous for a person
// and tight enough that one scraper cannot become the database's load.
const REGISTRY_READS_PER_MINUTE = 120;

export async function checkRegistryReadRate(ip: string): Promise<RateVerdict> {
  // With no address every anonymous reader would share one bucket and the
  // whole site would refuse after 120 reads a minute; that is a proxy that
  // stopped forwarding the address, which belongs in the log, not in a 429.
  if (!ip) {
    logEvent("ratelimit", { event: "no_client_ip" });
    return { ok: true };
  }
  const bumped = await bumpOrDeny(`registry-read:${ip}`, 60);
  return verdict(bumped, REGISTRY_READS_PER_MINUTE, "Too many requests from this address. Sign in or use an API key for a higher limit.");
}

export async function checkUserRate(userId: string): Promise<RateVerdict> {
  const bumped = await bumpOrDeny(`user:${userId}`, 3600);
  return verdict(bumped, PER_USER_HOUR, "You've hit the hourly build limit. Try again shortly.");
}

export async function checkBuildContinueRate(userId: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`build-continue:${userId}`, 60), 6, "Recovery is still checking. Try again in a minute.");
}

export async function checkWorkspaceReadRate(userId: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`workspace-read:${userId}`, 60), 120, "File updates reached their request limit. Retrying shortly.");
}

export async function checkEnhanceRate(userId: string, ip: string): Promise<RateVerdict> {
  if (!ip) return { ok: false, reason: "Prompt enhancement is unavailable. You can use your original prompt.", retryAfterSeconds: 60 };
  // Wallet creation is free. Account limits alone cannot bound shared model spend.
  const budgets = [
    { bucket: `enhance:${userId}`, seconds: 3600, limit: ENHANCE_PER_USER_HOUR },
    { bucket: `enhance-ip:${ip}`, seconds: 3600, limit: 60 },
    { bucket: "enhance:minute", seconds: 60, limit: 10 },
    { bucket: "enhance:day", seconds: 86_400, limit: 500 },
  ];
  for (const budget of budgets) {
    const result = verdict(await bumpOrDeny(budget.bucket, budget.seconds), budget.limit,
      "Prompt enhancement has reached its request limit. Try later or use your original prompt.");
    if (!result.ok) return result;
  }
  return { ok: true };
}

const KEY_PER_HOUR = 600;

// One key, one budget: a leaked or looping key cannot become the platform's load.
export async function checkKeyRate(keyId: string): Promise<RateVerdict> {
  const bumped = await bumpOrDeny(`key:${keyId}`, 3600);
  return verdict(bumped, KEY_PER_HOUR, "This API key has hit its hourly limit. Try again shortly.");
}

// The admin password gets a handful of tries per address and a small number
// across the whole site per window, so it cannot be guessed online.
const ADMIN_UNLOCK_PER_IP = 5;
const ADMIN_UNLOCK_GLOBAL = 30;
const ADMIN_UNLOCK_WINDOW_SECONDS = 15 * 60;

export async function checkAdminUnlockRate(ip: string): Promise<RateVerdict> {
  const [byIp, total] = await Promise.all([
    bumpOrDeny(`admin-unlock:ip:${ip}`, ADMIN_UNLOCK_WINDOW_SECONDS),
    bumpOrDeny("admin-unlock:all", ADMIN_UNLOCK_WINDOW_SECONDS),
  ]);
  const reason = "Too many attempts. Wait fifteen minutes and try again.";
  if (total.count > ADMIN_UNLOCK_GLOBAL) {
    return { ok: false, reason, retryAfterSeconds: total.resetInSeconds };
  }
  return verdict(byIp, ADMIN_UNLOCK_PER_IP, reason);
}

export async function checkIpRate(ip: string): Promise<RateVerdict> {
  if (!ip) {
    return { ok: true };
  }
  const bumped = await bumpOrDeny(`ip:${ip}`, 3600);
  return verdict(bumped, PER_IP_HOUR, "Too many builds from this network. Try again shortly.");
}

export class BuildDailyLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("Fletch has reached its daily build limit. No build was queued or credit charged. Try again after the limit resets.");
    this.name = "BuildDailyLimitError";
  }
}

// Reserve only inside the accepting build transaction. Refusals, replays and
// rolled-back builds must not consume another user's allowance.
export async function reserveDailyBuild(execute: CounterExecutor): Promise<void> {
  const result = await bump("global:day", 86_400, execute);
  if (!Number.isSafeInteger(GLOBAL_PER_DAY) || GLOBAL_PER_DAY < 1 || result.count > GLOBAL_PER_DAY) {
    throw new BuildDailyLimitError(result.resetInSeconds);
  }
}

export async function checkSessionApiRate(userId: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`session-api:${userId}`, 60), 240, "Too many requests. Wait for the limit to reset.");
}

// The daemon calls this before each eth_getLogs batch. One shared bucket across
// every watcher, because the ceiling is on total RPC spend for the day, not on
// any single watcher's share of it.
export async function checkRpcBudget(): Promise<RateVerdict> {
  const bumped = await bumpOrDeny("rpc:day", 86_400);
  return verdict(bumped, WATCH_LIMITS.rpcCallsPerDay, "Daily RPC budget reached.");
}

// The last hop is the one the proxy in front of this process wrote, whether it
// overwrites the header or appends to it; every earlier entry arrived from the
// client and is whatever it chose to send.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    return hops[hops.length - 1] ?? "";
  }
  return headers.get("x-real-ip")?.trim() ?? "";
}

export async function checkModelKeyRate(userId: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`model-key:${userId}`, 3600), 30, "Too many model-key changes. Try again later.");
}

export async function checkGatewayRelayRate(gatewayId: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`model-gateway-relay:${gatewayId}`, 60), 180, "Gateway request rate exceeded.");
}
export async function checkGatewayPairRate(ip: string): Promise<RateVerdict> {
  return verdict(await bumpOrDeny(`model-gateway-pair:${ip || "unknown"}`, 60), 20, "Too many pairing attempts. Try again later.");
}
