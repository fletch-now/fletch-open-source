// The whole reorg story for v1 (docs/MVP.md): a watcher stores one checkpoint
// block and that block's hash. If the chain's current hash at that height no
// longer matches, the sequencer reordered something at or before it, so the
// watcher rolls back and rescans. No provider gives Robinhood Chain reorg depth
// stats, so the walk-back is capped at a flat, documented guess rather than an
// unbounded search.
//
// No "server-only", no next/*, no React, no lib/dal — workers/watch.ts (a plain
// `tsx` process) imports this module directly.

import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { watcherDeliveries, watchers } from "@/lib/db/schema";
import { getBlockHeader } from "@/lib/chain/rpc";

// The transaction type poll.ts's per-watcher transaction (deliveries + checkpoint)
// and deliver.ts's claim transaction are given, extracted from db.transaction
// itself rather than hand-typed against drizzle's generic PgTransaction
// signature, so it always matches whatever `db` actually resolves to.
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const REORG_MAX_ROLLBACK_BLOCKS = BigInt(64);

// Pure: the whole "how far back" rule in one place, unit-tested without a chain
// client or a database. On mismatch, roll back by min(64, lastCheckedBlock)
// blocks. Clamping the rollback itself to lastCheckedBlock is what keeps the
// result at or above genesis — no separate floor is needed.
export function rollbackAncestor(lastCheckedBlock: bigint): bigint {
  const rollback = lastCheckedBlock < REORG_MAX_ROLLBACK_BLOCKS ? lastCheckedBlock : REORG_MAX_ROLLBACK_BLOCKS;
  return lastCheckedBlock - rollback;
}

export interface CheckpointedWatcher {
  id: string;
  lastCheckedBlock: bigint | null;
  lastCheckedBlockHash: string | null;
}

export interface ReorgResult {
  reorged: boolean;
  commonAncestor: bigint | null;
}

// A watcher with no checkpoint yet has nothing to compare against — every fresh
// watcher takes this path and is never "reorged".
export async function detectReorg(chainId: number, watcher: CheckpointedWatcher): Promise<ReorgResult> {
  if (watcher.lastCheckedBlock === null || !watcher.lastCheckedBlockHash) {
    return { reorged: false, commonAncestor: null };
  }
  const header = await getBlockHeader(chainId, watcher.lastCheckedBlock);
  // No header at all (pruned/unreachable) is not evidence of a reorg — there's
  // nothing to compare, so leave the checkpoint alone rather than guess.
  if (!header || header.hash === watcher.lastCheckedBlockHash) {
    return { reorged: false, commonAncestor: null };
  }
  return { reorged: true, commonAncestor: rollbackAncestor(watcher.lastCheckedBlock) };
}

export interface RollbackResult {
  hash: string | null;
}

// Rolls a watcher's checkpoint back to the common ancestor and retracts any
// outbox row for a block above it — a delivery already sent can't be un-sent, but
// one still pending for a block that may no longer exist must not go out.
export async function applyReorgRollback(chainId: number, watcherId: string, commonAncestor: bigint): Promise<RollbackResult> {
  const ancestorHeader = commonAncestor > BigInt(0) ? await getBlockHeader(chainId, commonAncestor) : null;
  const hash = ancestorHeader?.hash ?? null;

  await db.transaction(async function run(tx) {
    await tx
      .update(watcherDeliveries)
      .set({ status: "retracted" })
      .where(
        and(
          eq(watcherDeliveries.watcherId, watcherId),
          eq(watcherDeliveries.status, "pending"),
          gt(watcherDeliveries.blockNumber, commonAncestor),
        ),
      );
    await tx
      .update(watchers)
      .set({ lastCheckedBlock: commonAncestor, lastCheckedBlockHash: hash, status: "catching_up", updatedAt: new Date() })
      .where(eq(watchers.id, watcherId));
  });

  return { hash };
}

// Called inside the same transaction as that watcher's delivery inserts for this
// poll, so a crash between "wrote deliveries" and "advanced the checkpoint" can
// never happen — both commit together or neither does.
export async function advanceCheckpoint(
  tx: Tx,
  watcherId: string,
  block: bigint,
  hash: string,
  status: "active" | "catching_up",
): Promise<void> {
  await tx
    .update(watchers)
    .set({ lastCheckedBlock: block, lastCheckedBlockHash: hash, status, lastError: null, updatedAt: new Date() })
    .where(eq(watchers.id, watcherId));
}
