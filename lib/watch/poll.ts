// The scan loop (docs/MVP.md, ticket 6): for every enabled watcher on a chain,
// fetch new Transfer logs, match against threshold, write outbox rows, and move
// the checkpoint forward — one watcher at a time, but one `eth_getLogs` call per
// address shared by every watcher targeting it.
//
// No "server-only", no next/*, no React, no lib/dal — workers/watch.ts (a plain
// `tsx` process) imports this module directly.

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { watcherDeliveries, watchers } from "@/lib/db/schema";
import type { TrustStamp, WatcherStatus } from "@/lib/watch/types";
import { TRANSFER_KINDS, WATCH_LIMITS } from "@/lib/watch/types";
import { getAsset } from "@/lib/registry/assets";
import { readTokenMeta } from "@/lib/watch/token-meta";
import { trustForToken } from "@/lib/registry/trust";
import { getHead, getBlockHeader } from "@/lib/chain/rpc";
import { fetchTransferLogs, BudgetExceededError, type TransferLog } from "@/lib/chain/logs";
import { checkRpcBudget } from "@/lib/ratelimit";
import { buildPayload } from "@/lib/watch/format";
import { matchesWatcher, thresholdToRaw } from "@/lib/watch/match";
import { detectReorg, applyReorgRollback, advanceCheckpoint } from "@/lib/watch/checkpoint";
import { logEvent } from "@/lib/log";
import { redactSecrets } from "@/lib/redact";

type WatcherRow = typeof watchers.$inferSelect;

// A fresh watcher (no checkpoint yet) starts a little behind the head rather than
// exactly at it — MVP.md's "starts near the head" — so it doesn't miss a transfer
// that lands in the gap between "watcher created" and "first poll runs".
const FRESH_WATCHER_LAG_BLOCKS = BigInt(20);

function groupByAddress(rows: WatcherRow[]): Map<string, WatcherRow[]> {
  const groups = new Map<string, WatcherRow[]>();
  for (const row of rows) {
    const key = row.address.toLowerCase();
    const existing = groups.get(key);
    if (existing) {
      existing.push(row);
    } else {
      groups.set(key, [row]);
    }
  }
  return groups;
}

function minBigInt(values: bigint[]): bigint {
  return values.reduce(function pick(min, value) {
    return value < min ? value : min;
  }, values[0]);
}

async function setWatcherError(rows: WatcherRow[], message: string, status?: "degraded"): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  const ids = rows.map(function id(row) {
    return row.id;
  });
  await db
    .update(watchers)
    .set({ lastError: redactSecrets(message), updatedAt: new Date(), ...(status ? { status } : {}) })
    .where(inArray(watchers.id, ids));
}

// Runs the reorg check for every watcher in `rows` that has a checkpoint, and
// mutates the passed-in rows in place when a rollback happens — the group/from
// computation right after this needs each watcher's post-rollback checkpoint, not
// its pre-poll one.
async function checkReorgs(chainId: number, rows: WatcherRow[]): Promise<void> {
  for (const watcher of rows) {
    if (watcher.lastCheckedBlock === null || !watcher.lastCheckedBlockHash) {
      continue;
    }
    try {
      const result = await detectReorg(chainId, {
        id: watcher.id,
        lastCheckedBlock: watcher.lastCheckedBlock,
        lastCheckedBlockHash: watcher.lastCheckedBlockHash,
      });
      if (!result.reorged || result.commonAncestor === null) {
        continue;
      }
      const rollback = await applyReorgRollback(chainId, watcher.id, result.commonAncestor);
      watcher.lastCheckedBlock = result.commonAncestor;
      watcher.lastCheckedBlockHash = rollback.hash;
      watcher.status = "catching_up";
      logEvent("watch", {
        event: "reorg",
        watcherId: watcher.id,
        chainId,
        commonAncestor: result.commonAncestor.toString(),
      });
    } catch (error) {
      // A failed reorg check leaves the checkpoint untouched — the next poll
      // tries again rather than this poll guessing.
      logEvent("watch", { event: "reorg-check-failed", watcherId: watcher.id, chainId, error: String(error) });
    }
  }
}

async function stampFor(chainId: number, address: string): Promise<TrustStamp> {
  const verdict = await trustForToken(chainId, address);
  return {
    level: verdict.level,
    impersonates: verdict.impersonates ? { symbol: verdict.impersonates.symbol, address: verdict.impersonates.address } : null,
  };
}

export async function pollOnce(chainId: number): Promise<void> {
  const rows = await db
    .select()
    .from(watchers)
    .where(and(eq(watchers.chainId, chainId), eq(watchers.enabled, true), inArray(watchers.kind, [...TRANSFER_KINDS])));
  if (rows.length === 0) {
    return;
  }

  // A watcher points either at a registry asset or at a contract someone
  // deployed from a build; the second kind reads its own name, symbol and
  // decimals from the chain (lib/watch/token-meta.ts).
  const scannable = rows;

  await checkReorgs(chainId, scannable);

  const head = await getHead(chainId);
  const capSpan = BigInt(WATCH_LIMITS.logChunkBlocks) * BigInt(5);
  const groups = groupByAddress(scannable);

  for (const [address, groupWatchers] of groups) {
    const perWatcherFrom = new Map<string, bigint>();
    for (const watcher of groupWatchers) {
      const from =
        watcher.lastCheckedBlock !== null ? watcher.lastCheckedBlock + BigInt(1) : head.number - FRESH_WATCHER_LAG_BLOCKS;
      perWatcherFrom.set(watcher.id, from < BigInt(0) ? BigInt(0) : from);
    }
    const groupFrom = minBigInt(Array.from(perWatcherFrom.values()));
    if (groupFrom > head.number) {
      continue;
    }
    const cappedTo = groupFrom + capSpan - BigInt(1);
    const toBlock = cappedTo < head.number ? cappedTo : head.number;

    let logs: TransferLog[];
    try {
      logs = await fetchTransferLogs({
        chainId,
        address,
        fromBlock: groupFrom,
        toBlock,
        onRpcCall: async function withinBudget(): Promise<boolean> {
          return (await checkRpcBudget()).ok;
        },
      });
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        await setWatcherError(groupWatchers, error.message, "degraded");
      } else {
        const message = error instanceof Error ? error.message : String(error);
        await setWatcherError(groupWatchers, message);
        logEvent("watch", { event: "poll-fetch-failed", chainId, address, error: message });
      }
      continue;
    }

    let toBlockHash: string;
    if (toBlock === head.number) {
      toBlockHash = head.hash;
    } else {
      const header = await getBlockHeader(chainId, toBlock);
      // No header for a block we just scanned up to would be stranger than a
      // reorg — fall back to the head hash's block only as a last resort so the
      // checkpoint still advances rather than the watcher stalling forever.
      toBlockHash = header?.hash ?? head.hash;
    }

    const nextStatus: WatcherStatus = head.number - toBlock > BigInt(WATCH_LIMITS.catchingUpBlocks) ? "catching_up" : "active";

    for (const watcher of groupWatchers) {
      const watcherFrom = perWatcherFrom.get(watcher.id);
      if (watcherFrom === undefined || watcherFrom > toBlock) {
        continue;
      }

      try {
        const asset = watcher.assetId
          ? await getAsset(watcher.assetId)
          : await readTokenMeta(chainId, watcher.address);
        if (!asset) {
          await setWatcherError(
            [watcher],
            watcher.assetId ? "registry asset no longer exists" : "the contract did not answer name, symbol and decimals",
          );
          continue;
        }

        const thresholdRaw = thresholdToRaw(watcher.threshold, asset.decimals);
        const matchWatcher = { kind: watcher.kind, wallet: watcher.wallet, thresholdRaw };
        const matches: Array<{ log: TransferLog; direction?: "in" | "out" }> = [];
        for (const log of logs) {
          if (log.blockNumber < watcherFrom || log.blockNumber > toBlock) {
            continue;
          }
          const result = matchesWatcher(matchWatcher, log);
          if (result.matched) {
            matches.push({ log, direction: result.direction });
          }
        }

        // What the registry can say about this token, read once per poll for a
        // watcher that matched something rather than per log. A person acting
        // on an alert about a token called TSLA needs to know in the message
        // whether it is the listed one.
        const trust: TrustStamp | undefined = matches.length === 0 ? undefined : await stampFor(chainId, watcher.address);

        await db.transaction(async function run(tx) {
          for (const { log, direction } of matches) {
            const payload = buildPayload({
              kind: watcher.kind,
              chainId,
              address: watcher.address,
              symbol: asset.symbol,
              name: asset.name,
              decimals: asset.decimals,
              from: log.from,
              to: log.to,
              value: log.value,
              threshold: watcher.threshold,
              txHash: log.txHash,
              logIndex: log.logIndex,
              blockNumber: log.blockNumber,
              blockHash: log.blockHash,
              wallet: watcher.wallet ?? undefined,
              direction,
              trust,
            });
            await tx
              .insert(watcherDeliveries)
              .values({
                id: `dl_${randomUUID()}`,
                watcherId: watcher.id,
                userId: watcher.userId,
                txHash: log.txHash,
                logIndex: log.logIndex,
                blockNumber: log.blockNumber,
                blockHash: log.blockHash,
                payload,
                status: "pending",
              })
              // The unique (watcher, tx, logIndex) index is the idempotency key —
              // a rescanned block (catch-up, reorg rescan) can never double-insert.
              .onConflictDoNothing();
          }
          await advanceCheckpoint(tx, watcher.id, toBlock, toBlockHash, nextStatus);
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await setWatcherError([watcher], message);
        logEvent("watch", { event: "poll-watcher-failed", watcherId: watcher.id, chainId, error: message });
      }
    }
  }
}
