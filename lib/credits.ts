import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { creditEvents, walletAddress } from "@/lib/db/schema";
import { walletHasActivity } from "@/lib/abuse";
import { ensureStarterCredit } from "@/lib/starter-credit";
import { FREE_BUILD_GRANT } from "@/lib/config";

// No "server-only": the watch daemon (a plain tsx process) credits payments
// through grantPurchase, and the marker would refuse to load there.
// Balance is always SUM(delta) over the append-only ledger — never a stored column.
export async function getBalance(userId: string): Promise<number> {
  const rows = await db
    .select({ balance: sql<string>`coalesce(sum(${creditEvents.delta}), 0)` })
    .from(creditEvents)
    .where(eq(creditEvents.userId, userId));
  return Number(rows[0]?.balance ?? 0);
}

// One free grant per user, ever. The UNIQUE idempotency key makes a repeat a no-op,
// so double-granting is structurally impossible rather than guarded in application logic.
export type FreeGrantOutcome = "granted" | "already" | "no-wallet" | "ineligible";

// The free grant happens at the first build attempt, for a wallet that has already
// transacted or holds a balance on Robinhood Chain. A fresh, empty wallet — the
// shape every sybil farm produces — gets nothing until it shows some life.
export async function ensureFreeGrantIfEligible(userId: string): Promise<FreeGrantOutcome> {
  const starter = await ensureStarterCredit(userId);
  if (starter === "granted" || starter === "already") return starter;
  if (starter === "no-wallet") return "no-wallet";
  const existing = await db
    .select({ id: creditEvents.id })
    .from(creditEvents)
    .where(eq(creditEvents.idempotencyKey, `free_grant:${userId}`))
    .limit(1);
  if (existing[0]) {
    return "already";
  }
  const wallets = await db
    .select({ address: walletAddress.address })
    .from(walletAddress)
    .where(eq(walletAddress.userId, userId))
    .limit(1);
  const wallet = wallets[0]?.address;
  if (!wallet) {
    return "no-wallet";
  }
  if (!(await walletHasActivity(wallet))) {
    return "ineligible";
  }
  await ensureFreeGrant(userId);
  return "granted";
}

export async function ensureFreeGrant(userId: string): Promise<void> {
  await db
    .insert(creditEvents)
    .values({
      id: randomUUID(),
      userId,
      delta: FREE_BUILD_GRANT,
      reason: "free_grant",
      idempotencyKey: `free_grant:${userId}`,
    })
    .onConflictDoNothing({ target: creditEvents.idempotencyKey });
}

// Credit a purchase. Idempotent on the on-chain transaction, so the browser's
// confirmation and the daemon's sweep can both report the same payment and only
// one row lands. Returns whether this call inserted it.
export async function grantPurchase(
  userId: string,
  credits: number,
  externalRef: string,
  idempotencyKey: string,
): Promise<boolean> {
  const inserted = await db
    .insert(creditEvents)
    .values({
      id: randomUUID(),
      userId,
      delta: credits,
      reason: "purchase",
      externalRef,
      idempotencyKey,
    })
    .onConflictDoNothing({ target: creditEvents.idempotencyKey })
    .returning({ id: creditEvents.id });
  return inserted.length > 0;
}

// Refund only an actual debit. BYOK builds never spend a credit, and their
// failure must not mint one. The unique refund key also covers concurrent retries.
export async function refundBuild(userId: string, buildId: string): Promise<void> {
  await db.execute(sql`
    insert into credit_events (id, user_id, delta, reason, build_id, idempotency_key)
    select ${randomUUID()}, user_id, -delta, 'refund', build_id, ${`refund:${buildId}`}
    from credit_events
    where user_id = ${userId} and build_id = ${buildId}
      and idempotency_key = ${`build_debit:${buildId}`}
      and reason = 'build_debit' and delta < 0
      and not exists (select 1 from builds b where b.id = ${buildId} and b.billing_mode = 'own_key')
    on conflict (idempotency_key) do nothing
  `);
}
