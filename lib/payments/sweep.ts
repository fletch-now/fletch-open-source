import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { daemonHeartbeats } from "@/lib/db/schema";
import { fetchTransferLogs, type TransferLog } from "@/lib/chain/logs";
import { getHead } from "@/lib/chain/rpc";
import { grantPurchase } from "@/lib/credits";
import { checkRpcBudget } from "@/lib/ratelimit";
import { logEvent } from "@/lib/log";
import { creditsFor, parseTreasury, purchaseKey, sumValue, USDG } from "@/lib/payments/usdg";

// The daemon's view of payments: every USDG transfer into the treasury, whether
// or not a browser ever reported it. Someone who paid from a phone and closed
// the tab, or whose confirmation request failed, is credited here within a
// minute. The credit row's unique key is the same one the route uses, so a
// payment seen by both lands once. No "server-only": workers/watch.ts imports this.

// Robinhood Chain lands a block about every 100 ms; 20,000 blocks is roughly
// half an hour, wide enough that a daemon restart never loses a payment.
const FIRST_RUN_LOOKBACK = BigInt(20_000);
const CHECKPOINT_NAME = "treasury-sweep";

export interface SweepResult {
  scanned: { from: string; to: string } | null;
  transfers: number;
  credited: number;
}

// One transaction can carry several transfers; the route sums the receipt, so
// the sweep sums per transaction too, and both derive the same credits.
export function groupByTransaction(logs: TransferLog[]): Map<string, TransferLog[]> {
  const groups = new Map<string, TransferLog[]>();
  for (const log of logs) {
    const key = log.txHash.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push(log);
    groups.set(key, group);
  }
  return groups;
}

async function readCheckpoint(): Promise<bigint | null> {
  const rows = await db.select({ headBlock: daemonHeartbeats.headBlock }).from(daemonHeartbeats).where(sql`${daemonHeartbeats.name} = ${CHECKPOINT_NAME}`).limit(1);
  return rows[0]?.headBlock ?? null;
}

async function writeCheckpoint(block: bigint, detail: object): Promise<void> {
  await db
    .insert(daemonHeartbeats)
    .values({ name: CHECKPOINT_NAME, lastBeatAt: sql`now()`, headBlock: block, detail })
    .onConflictDoUpdate({ target: daemonHeartbeats.name, set: { lastBeatAt: sql`now()`, headBlock: block, detail } });
}

// The account that owns the paying wallet, if any. Wallet rows keep the casing
// the wallet reported; logs come back lowercased.
async function ownerOf(from: string): Promise<string | null> {
  const rows = await db.execute<{ user_id: string }>(sql`SELECT user_id FROM wallet_address WHERE lower(address) = ${from.toLowerCase()} LIMIT 1`);
  return rows.rows[0]?.user_id ?? null;
}

export async function sweepTreasuryPayments(): Promise<SweepResult> {
  const treasury = parseTreasury(process.env.FLETCH_TREASURY_ADDRESS);
  if (!treasury) {
    return { scanned: null, transfers: 0, credited: 0 };
  }
  const head = await getHead(USDG.chainId);
  const checkpoint = await readCheckpoint();
  const fromBlock = checkpoint === null ? head.number - FIRST_RUN_LOOKBACK : checkpoint + BigInt(1);
  if (fromBlock > head.number) {
    return { scanned: null, transfers: 0, credited: 0 };
  }

  const logs = await fetchTransferLogs({
    chainId: USDG.chainId,
    address: USDG.address,
    to: treasury,
    fromBlock,
    toBlock: head.number,
    onRpcCall: async function withinBudget() {
      return (await checkRpcBudget()).ok;
    },
  });

  let credited = 0;
  for (const [txHash, group] of groupByTransaction(logs)) {
    const userId = await ownerOf(group[0].from);
    if (!userId) {
      logEvent("payments", { event: "unknown-sender", txHash, from: group[0].from });
      continue;
    }
    const credits = creditsFor(sumValue(group));
    if (credits === 0) {
      continue;
    }
    const inserted = await grantPurchase(userId, credits, txHash, purchaseKey(txHash));
    if (inserted) {
      credited += 1;
      logEvent("payments", { event: "credited-by-sweep", userId, txHash, credits });
    }
  }

  await writeCheckpoint(head.number, { fromBlock: fromBlock.toString(), transfers: logs.length, credited });
  return { scanned: { from: fromBlock.toString(), to: head.number.toString() }, transfers: logs.length, credited };
}
