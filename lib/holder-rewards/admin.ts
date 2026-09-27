import "server-only";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { activationProblem, HOLDER_CAMPAIGN, HOLDER_POLICY_KEY, HolderPolicySchema, type HolderPolicy } from "./model";
import { HolderReadingError, observeHolding } from "./observe";
import { readHolderPolicy } from "./store";

export async function saveHolderPolicy(input: unknown, expectedRevision: number, operatorId: string | null,
  database = db, observe = observeHolding): Promise<HolderPolicy> {
  const next = HolderPolicySchema.parse(input);
  if (next.chainId && next.tokenAddress && !next.referencePoolId) {
    const selected = await database.execute<{ pool_id: string }>(sql`select pp.pool_id from registry_priority_pools pp
      join dex_pools p on p.id=pp.pool_id and p.chain_id=pp.chain_id and p.canonical
      where pp.chain_id=${next.chainId} and pp.address=${next.tokenAddress} and pp.selected
      order by pp.observed_at desc nulls last,pp.pool_id limit 1`);
    next.referencePoolId = selected.rows[0]?.pool_id ?? null;
  }
  if (next.enabled) {
    const problem = activationProblem(next);
    if (problem) throw new HolderReadingError(problem);
    try { await observe(next, `0x${"0".repeat(40)}`); }
    catch (error) { throw new HolderReadingError(error instanceof HolderReadingError ? error.message : "The token and reference market could not pass live verification. The policy remains unchanged."); }
  }
  return database.transaction(async function save(tx) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${HOLDER_CAMPAIGN}))`);
    const current = await readHolderPolicy(tx);
    if (current.revision !== expectedRevision) throw new HolderReadingError("This policy changed in another session. Reload before saving.");
    if (current.activatedAt && (current.tokenAddress !== next.tokenAddress || current.chainId !== next.chainId || current.period !== next.period)) throw new HolderReadingError("An activated campaign keeps its token, network and reward period. Pause it before planning a separate campaign.");
    const saved = { ...next, revision: current.revision + 1, activatedAt: current.activatedAt ?? (next.enabled ? new Date().toISOString() : null) };
    await tx.execute(sql`insert into app_settings(key,value,updated_by) values(${HOLDER_POLICY_KEY},${JSON.stringify(saved)},${operatorId ?? "console"})
      on conflict(key) do update set value=excluded.value,updated_by=excluded.updated_by,updated_at=now()`);
    await tx.execute(sql`insert into audit_log(id,user_id,actor_type,action,resource_type,resource_id,metadata)
      values(${`al_${randomUUID()}`},${operatorId},'system','credits.holder_policy','holder_reward',${HOLDER_CAMPAIGN},${JSON.stringify({ before: current, after: saved })}::jsonb)`);
    return saved;
  });
}
