import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Hex } from "viem";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { walletAddress } from "@/lib/db/schema";
import { getBalance, grantPurchase } from "@/lib/credits";
import { recordAudit } from "@/lib/audit";
import { checkUserRate } from "@/lib/ratelimit";
import { treasuryAddress } from "@/lib/payments/treasury";
import { purchaseKey, verifyUsdgPayment } from "@/lib/payments/usdg";
import { logEvent } from "@/lib/log";

// A person paid USDG to the treasury and hands over the transaction hash. The
// server reads the receipt itself, credits what was paid, and records the same
// row at most once per transaction: the ledger's unique idempotency key is what
// makes a second submission, from a retry or from the daemon's sweep, a no-op.

const Body = z.object({ txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/) });

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const treasury = treasuryAddress();
  if (!treasury) {
    return NextResponse.json({ error: "Credit purchases are not open on this deployment." }, { status: 503 });
  }
  const userId = session.user.id;
  // Each check is an RPC read; a looping client must not turn into RPC spend.
  const rate = await checkUserRate(`purchase:${userId}`);
  if (!rate.ok) {
    return NextResponse.json({ error: rate.reason }, { status: 429 });
  }
  const parsed = Body.safeParse(await request.json().catch(function ignore() { return null; }));
  if (!parsed.success) {
    return NextResponse.json({ error: "Paste the transaction hash, 0x followed by 64 hex characters." }, { status: 400 });
  }
  const txHash = parsed.data.txHash as Hex;
  const wallets = await db.select({ address: walletAddress.address }).from(walletAddress).where(eq(walletAddress.userId, userId));

  const verdict = await verifyUsdgPayment(txHash, treasury, wallets.map((row) => row.address));
  if (!verdict.ok) {
    if (verdict.pending) {
      return NextResponse.json({ pending: true }, { status: 202 });
    }
    return NextResponse.json({ error: verdict.reason }, { status: 422 });
  }

  const inserted = await grantPurchase(userId, verdict.credits, txHash, purchaseKey(txHash));
  if (inserted) {
    await recordAudit({
      userId,
      actorType: "user",
      action: "credits.purchase",
      resourceType: "tx",
      resourceId: txHash,
      metadata: { credits: verdict.credits, paidUnits: verdict.paidUnits.toString() },
    });
    logEvent("payments", { event: "credited", userId, txHash, credits: verdict.credits });
  }
  const balance = await getBalance(userId);
  return NextResponse.json({ credits: verdict.credits, already: !inserted, balance });
}
