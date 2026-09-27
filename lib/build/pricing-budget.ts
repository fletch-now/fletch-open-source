import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { BuildAllowance } from "./pricing-policy";

export interface AllowanceReading {
  legacy: boolean;
  allowed: boolean;
  reason?: "model_requests" | "tool_runs" | "active_time" | "settled";
  remaining: BuildAllowance | null;
}

// Called within the worker's fenced transaction. The build lock also serializes
// an owner's explicit extension acceptance against dispatch and settlement.
export async function readBuildAllowance(client: PoolClient, buildId: string): Promise<AllowanceReading> {
  const build = await client.query("select to_jsonb(builds)->'pricing_snapshot' as pricing_snapshot from builds where id=$1 for update", [buildId]);
  if (!build.rows[0]) throw new Error("Build not found.");
  if (!build.rows[0].pricing_snapshot) return { legacy: true, allowed: true, remaining: null };
  const settled = await client.query("select 1 from build_pricing_settlements where build_id=$1", [buildId]);
  if (settled.rowCount) return { legacy: false, allowed: false, reason: "settled", remaining: null };
  const [authorization, usage] = await Promise.all([
    client.query<{ allowance: BuildAllowance }>("select allowance from build_budget_authorizations where build_id=$1 order by packages desc limit 1", [buildId]),
    client.query<{ kind: string; units: string }>("select kind,sum(units)::text as units from build_budget_usage where build_id=$1 group by kind", [buildId]),
  ]);
  const allowance = authorization.rows[0]?.allowance;
  if (!allowance) throw new Error("Accepted build has no budget authorization.");
  const used = Object.fromEntries(usage.rows.map(row => [row.kind, Number(row.units)]));
  const remaining = { modelRequests: Math.max(0, allowance.modelRequests - (used.model_request ?? 0)),
    toolRuns: Math.max(0, allowance.toolRuns - (used.tool_run ?? 0)),
    activeSeconds: Math.max(0, allowance.activeSeconds - (used.active_time ?? 0)),
    maxAgentStepsPerTurn: allowance.maxAgentStepsPerTurn };
  return { legacy: false, allowed: remaining.activeSeconds > 0, reason: remaining.activeSeconds > 0 ? undefined : "active_time", remaining };
}

export async function guardBuildAllowance(client: PoolClient, buildId: string, effectKey: string, kind: "model_request" | "tool_run"): Promise<AllowanceReading> {
  if (!effectKey || effectKey.length > 500) throw new Error("Invalid dispatch identity.");
  const reading = await readBuildAllowance(client, buildId);
  if (reading.legacy || reading.reason === "settled") return reading;
  const existing = await client.query("select 1 from build_budget_usage where build_id=$1 and effect_key=$2 and kind=$3", [buildId, effectKey, kind]);
  if (existing.rowCount) return { ...reading, allowed: true, reason: undefined };
  if (!reading.allowed) return reading;
  const field = kind === "model_request" ? "modelRequests" : "toolRuns";
  if (!reading.remaining || reading.remaining[field] < 1) return { ...reading, allowed: false, reason: kind === "model_request" ? "model_requests" : "tool_runs" };
  await client.query("insert into build_budget_usage(build_id,effect_key,kind,units) values($1,$2,$3,1)", [buildId, effectKey, kind]);
  return { ...reading, remaining: { ...reading.remaining, [field]: reading.remaining[field] - 1 } };
}

export async function recordBuildActiveSeconds(client: PoolClient, buildId: string, segmentId: string, seconds: number): Promise<void> {
  if (!segmentId || segmentId.length > 500 || !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86_400) throw new Error("Invalid active-time observation.");
  const reading = await readBuildAllowance(client, buildId);
  if (reading.legacy) return;
  if (reading.reason === "settled") throw new Error("Build pricing is already settled.");
  const previous = await client.query("select units from build_budget_usage where build_id=$1 and effect_key=$2 and kind='active_time'", [buildId, segmentId]);
  if (previous.rowCount) {
    if (previous.rows[0].units !== seconds) throw new Error("Conflicting active-time receipt.");
    return;
  }
  await client.query("insert into build_budget_usage(build_id,effect_key,kind,units) values($1,$2,'active_time',$3)", [buildId, segmentId, seconds]);
}

type SettlementExecutor = (statement: SQL) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;

// Both HTTP queue cancellation (Drizzle) and worker finalization (pg) call this
// same transaction-local settlement; neither opens a second transaction.
export async function settlePricingWith(execute: SettlementExecutor, buildId: string, outcome: "succeeded" | "failed" | "stopped"): Promise<boolean> {
  const build = await execute(sql`select user_id,billing_mode,to_jsonb(builds)->'pricing_snapshot' as pricing_snapshot from builds where id=${buildId} for update`);
  const row = build.rows[0];
  if (!row?.pricing_snapshot) return false;
  const auth = await execute(sql`select id,incremental_credits from build_budget_authorizations where build_id=${buildId} order by packages`);
  if (!auth.rowCount) throw new Error("Accepted build has no authorization.");
  for (const item of auth.rows) {
    if (!item.incremental_credits) continue;
    const reserve = await execute(sql`select 1 from credit_events where build_id=${buildId} and user_id=${row.user_id}
      and idempotency_key=${`reserve:${item.id}`} and reason='build_reserve' and delta=${-Number(item.incremental_credits)}`);
    if (!reserve.rowCount) throw new Error("Accepted credit reservation is missing.");
  }
  const total = auth.rows.reduce((sum, item) => sum + Number(item.incremental_credits), 0);
  const released = outcome === "succeeded" ? 0 : total;
  const result = await execute(sql`insert into build_pricing_settlements(build_id,outcome,charged_credits,released_credits)
    values(${buildId},${outcome},${total - released},${released}) on conflict do nothing returning build_id`);
  if (!result.rowCount) return true;
  if (row.billing_mode === "own_key" && total !== 0) throw new Error("BYOK pricing must not reserve Fletch credits.");
  if (released) {
    for (const item of auth.rows) {
      if (!item.incremental_credits) continue;
      await execute(sql`insert into credit_events(id,user_id,delta,reason,build_id,idempotency_key)
        select ${randomUUID()},user_id,-delta,'build_release',build_id,${`release:${item.id}`} from credit_events
        where build_id=${buildId} and user_id=${row.user_id} and idempotency_key=${`reserve:${item.id}`}
          and reason='build_reserve' and delta=${-Number(item.incremental_credits)}
        on conflict(idempotency_key) do nothing`);
    }
  }
  return true;
}

export async function settleBuildPricing(client: PoolClient, buildId: string, outcome: "succeeded" | "failed" | "stopped"): Promise<boolean> {
  const dialect = new PgDialect();
  return settlePricingWith(function execute(statement) {
    const query = dialect.sqlToQuery(statement);
    return client.query(query.sql, query.params);
  }, buildId, outcome);
}
