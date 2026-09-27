import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export const STARTER_CREDIT_SETTING = "credits.starter.enabledAt";
import { STARTER_CREDITS } from "@/lib/config";
export type StarterCreditOutcome = "granted" | "already" | "not-new" | "no-wallet" | "disabled";

// The claim survives account deletion, so reconnecting the same address or
// using it on another supported chain cannot mint another welcome credit.
export async function ensureStarterCredit(userId: string, database = db): Promise<StarterCreditOutcome> {
  return database.transaction(async function grant(tx): Promise<StarterCreditOutcome> {
    const result = await tx.execute<{ enabled_at: string | null; address: string | null }>(sql`
      select (select value from app_settings where key=${STARTER_CREDIT_SETTING}) as enabled_at,
        (select lower(address) from wallet_address where user_id=u.id order by created_at,id limit 1) as address
      from "user" u where u.id=${userId} for update of u
    `);
    const row = result.rows[0];
    if (!row?.enabled_at) return "disabled";
    const enabledAt = Date.parse(row.enabled_at);
    if (!Number.isFinite(enabledAt)) throw new Error("Starter credit activation time is invalid.");
    const eligible = await tx.execute(sql`select 1 from "user" where id=${userId} and created_at >= ${new Date(enabledAt).toISOString()}::timestamptz at time zone 'UTC'`);
    if (!eligible.rows.length) return "not-new";
    if (!row.address || !/^0x[0-9a-f]{40}$/.test(row.address)) return "no-wallet";
    const existing = await tx.execute(sql`select 1 from credit_events where idempotency_key=${`free_grant:${userId}`}`);
    if (existing.rows.length) return "already";
    const claimed = await tx.execute(sql`
      insert into starter_credit_claims(address,user_id) values(${row.address},${userId})
      on conflict(address) do nothing returning address
    `);
    if (!claimed.rows.length) return "already";
    await tx.execute(sql`
      insert into credit_events(id,user_id,delta,reason,idempotency_key,external_ref)
      values(${randomUUID()},${userId},${STARTER_CREDITS},'free_grant',${`free_grant:${userId}`},${row.address})
    `);
    return "granted";
  });
}
