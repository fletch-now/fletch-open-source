import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { abuseSignals } from "@/lib/db/schema";
import { getChainClient } from "@/lib/chain/rpc";
import { RH_MAINNET_ID } from "@/lib/config";
import { logEvent } from "@/lib/log";

// Free compute is the thing a sybil farms: mint a thousand wallets, collect a
// thousand grants, run a thousand builds. A wallet that has never sent a
// transaction or held a balance on Robinhood Chain is not a person yet; it gets
// no free credits until it is. The verdict is cached per wallet for a day.

const VERDICT_TTL_MS = 24 * 60 * 60 * 1000;

export type WalletVerdict = "allow" | "deny";

async function cachedVerdict(wallet: string): Promise<WalletVerdict | null> {
  const rows = await db
    .select({ verdict: abuseSignals.verdict, createdAt: abuseSignals.createdAt })
    .from(abuseSignals)
    .where(eq(abuseSignals.wallet, wallet))
    .orderBy(desc(abuseSignals.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row || Date.now() - row.createdAt.getTime() > VERDICT_TTL_MS) {
    return null;
  }
  return row.verdict === "deny" ? "deny" : "allow";
}

export async function walletHasActivity(wallet: string): Promise<boolean> {
  const normalized = wallet.toLowerCase();
  const cached = await cachedVerdict(normalized);
  if (cached) {
    return cached === "allow";
  }
  const client = getChainClient(RH_MAINNET_ID);
  const address = normalized as `0x${string}`;
  let txCount = 0;
  let balance = BigInt(0);
  try {
    [txCount, balance] = await Promise.all([client.getTransactionCount({ address }), client.getBalance({ address })]);
  } catch (cause) {
    // An RPC failure must not lock a real person out; it also must not hand a
    // grant to a fresh wallet. Deny for now and try again on the next attempt.
    logEvent("abuse", { event: "rpc-failed", wallet: normalized, error: String(cause) });
    return false;
  }
  const active = txCount > 0 || balance > BigInt(0);
  await db.insert(abuseSignals).values({
    id: randomUUID(),
    wallet: normalized,
    walletTxCount: txCount,
    verdict: active ? "allow" : "deny",
  });
  logEvent("abuse", { event: "wallet-check", wallet: normalized, txCount, active });
  return active;
}
