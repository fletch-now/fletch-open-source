// The holder ledger: every Transfer of every issued asset, applied as balance
// deltas and daily totals, never stored one row at a time. Fifty million
// rows would say nothing a running balance does not, and the aggregates are
// what a page or an agent asks for: who holds it, how much moved today, how
// much of that settled against USDG, how much happened outside market hours.

import { sql } from "drizzle-orm";
import { zeroAddress, type Address, type PublicClient } from "viem";
import { db } from "@/lib/db";
import { assetActivityDaily, holderBalances } from "@/lib/db/schema";
import { logEvent } from "@/lib/log";
import { STOCK_ABI } from "@/lib/registry/authority/abis";
import { activeAssets, type TrackedAsset } from "@/lib/registry/authority/assets";
import { blockHash, decodeLogs, l2Client, scanLogs } from "@/lib/registry/authority/chain";
import { backfillStart, GENESIS_SCAN_BLOCK } from "@/lib/registry/authority/constants";
import { markCovered, uncoveredAssets } from "@/lib/registry/authority/coverage";
import { readCheckpoint, recordedHead, writeCheckpoint, type RunOutcome, type Executor } from "@/lib/registry/authority/runs";

export const LEDGER_NAME = "transfer-ledger";
// Deltas cannot be taken back, so the ledger trails the head far enough that
// a reorg under it would be a chain-level incident rather than a bad day.
const CONFIRMATIONS = BigInt(300);
// Dense transfer responses exceed the provider cap long before sparse factory
// events do. Start bounded; the scanner still halves a refused window.
const LEDGER_LOG_CHUNK = BigInt(5_000);
// The public RPC returns at most 10,000 logs per call; at today's density
// (about sixteen transfers a block) that is a few hundred blocks.
const LEDGER_MIN_CHUNK = BigInt(25);
// The genesis backfill is history; the jobs that read the present share the
// same public quota (about thirty requests a minute measured from the box)
// and come first. Five seconds between ledger windows leaves them room.
const LEDGER_PACE_MS = 5_000;
const WRITE_BATCH = 500;

interface DecodedTransfer {
  assetId: string;
  txHash: string;
  blockNumber: bigint;
  from: string;
  to: string;
  value: bigint;
}

interface DayStats {
  transfers: number;
  volume: bigint;
  mints: number;
  burns: number;
  dvp: number;
  offhours: number;
}

async function ledgerAssets(chainId: number): Promise<TrackedAsset[]> {
  const assets = await activeAssets(chainId);
  return assets.filter((asset) => asset.assetType !== "wrapped_native");
}

interface ActivityBucket {
  day: string;
  marketOpen: boolean;
}

// Activity stores day and market-hours categories, not individual timestamps.
// Both are constant within a UTC half-hour. Read exact endpoint timestamps and
// split only across bucket boundaries; never interpolate a block timestamp.
export async function activityBuckets(chainId: number, blocks: bigint[], client: PublicClient = l2Client(chainId)): Promise<Map<bigint, ActivityBucket>> {
  const sorted = [...new Set(blocks)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const timestamps = new Map<bigint, number>();
  const buckets = new Map<bigint, ActivityBucket>();
  async function timestamp(blockNumber: bigint): Promise<number> {
    const cached = timestamps.get(blockNumber);
    if (cached !== undefined) return cached;
    const block = await client.getBlock({ blockNumber });
    const value = Number(block.timestamp);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid ledger block timestamp");
    timestamps.set(blockNumber, value);
    return value;
  }
  async function classify(start: number, end: number): Promise<void> {
    const first = await timestamp(sorted[start]);
    const last = await timestamp(sorted[end]);
    if (last < first) throw new Error("Ledger block timestamps are not monotonic; checkpoint retained");
    if (Math.floor(first / 1800) === Math.floor(last / 1800)) {
      const bucket = { day: dayOf(first), marketOpen: withinMarketHours(first) };
      for (let index = start; index <= end; index += 1) buckets.set(sorted[index], bucket);
      return;
    }
    const middle = Math.floor((start + end) / 2);
    const leftEnd = await timestamp(sorted[middle]);
    const rightStart = await timestamp(sorted[middle + 1]);
    if (leftEnd < first || rightStart < leftEnd || last < rightStart) {
      throw new Error("Ledger block timestamps are not monotonic; checkpoint retained");
    }
    await classify(start, middle);
    await classify(middle + 1, end);
  }
  if (sorted.length > 0) await classify(0, sorted.length - 1);
  return buckets;
}

const newYork = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "numeric", hour12: false });
const marketHoursMemo = new Map<number, boolean>();

// US equities trade 09:30 to 16:00 New York time on weekdays. Holidays are
// not modelled; a holiday's transfers count as in-hours, which understates
// off-hours activity rather than inventing it.
function withinMarketHours(timestamp: number): boolean {
  const minute = Math.floor(timestamp / 60);
  const memo = marketHoursMemo.get(minute);
  if (memo !== undefined) {
    return memo;
  }
  const parts = newYork.formatToParts(new Date(timestamp * 1000));
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0) % 24;
  const minuteOfHour = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const clock = hour * 60 + minuteOfHour;
  const open = !["Sat", "Sun"].includes(weekday) && clock >= 9 * 60 + 30 && clock < 16 * 60;
  if (marketHoursMemo.size > 100_000) {
    marketHoursMemo.clear();
  }
  marketHoursMemo.set(minute, open);
  return open;
}

function dayOf(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function emptyStats(): DayStats {
  return { transfers: 0, volume: BigInt(0), mints: 0, burns: 0, dvp: 0, offhours: 0 };
}

async function writeBalances(executor: Executor, deltas: Map<string, { assetId: string; holder: string; delta: bigint }>, toBlock: bigint): Promise<void> {
  const rows = [...deltas.values()].filter((entry) => entry.delta !== BigInt(0));
  for (let start = 0; start < rows.length; start += WRITE_BATCH) {
    await executor
      .insert(holderBalances)
      .values(rows.slice(start, start + WRITE_BATCH).map((entry) => ({ assetId: entry.assetId, holder: entry.holder, rawBalance: entry.delta.toString(), updatedBlock: toBlock })))
      .onConflictDoUpdate({
        target: [holderBalances.assetId, holderBalances.holder],
        set: { rawBalance: sql`${holderBalances.rawBalance} + excluded.raw_balance`, updatedBlock: toBlock },
      });
  }
}

async function writeActivity(executor: Executor, stats: Map<string, { assetId: string; day: string; stats: DayStats }>): Promise<void> {
  const rows = [...stats.values()];
  for (let start = 0; start < rows.length; start += WRITE_BATCH) {
    await executor
      .insert(assetActivityDaily)
      .values(
        rows.slice(start, start + WRITE_BATCH).map((entry) => ({
          id: `${entry.assetId}:${entry.day}`,
          assetId: entry.assetId,
          day: entry.day,
          transfers: entry.stats.transfers,
          volumeRaw: entry.stats.volume.toString(),
          mints: entry.stats.mints,
          burns: entry.stats.burns,
          dvpTransfers: entry.stats.dvp,
          offhoursTransfers: entry.stats.offhours,
        })),
      )
      .onConflictDoUpdate({
        target: assetActivityDaily.id,
        set: {
          transfers: sql`${assetActivityDaily.transfers} + excluded.transfers`,
          volumeRaw: sql`${assetActivityDaily.volumeRaw} + excluded.volume_raw`,
          mints: sql`${assetActivityDaily.mints} + excluded.mints`,
          burns: sql`${assetActivityDaily.burns} + excluded.burns`,
          dvpTransfers: sql`${assetActivityDaily.dvpTransfers} + excluded.dvp_transfers`,
          offhoursTransfers: sql`${assetActivityDaily.offhoursTransfers} + excluded.offhours_transfers`,
          updatedAt: sql`now()`,
        },
      });
  }
}

// One window of logs, turned into balance deltas and daily totals and written.
async function applyWindow(executor: Executor, all: DecodedTransfer[], settlementIds: Set<string>, applyIds: Set<string> | null, toBlock: bigint, buckets: Map<bigint, ActivityBucket>): Promise<void> {
  // A per-asset backfill carries the stablecoin's logs only to recognise
  // settlement; applying them again would double every USDG balance.
  const transfers = applyIds ? all.filter((transfer) => applyIds.has(transfer.assetId)) : all;
  if (transfers.length === 0) {
    return;
  }
  const settledTxs = new Set(all.filter((transfer) => settlementIds.has(transfer.assetId)).map((transfer) => transfer.txHash));
  const deltas = new Map<string, { assetId: string; holder: string; delta: bigint }>();
  const days = new Map<string, { assetId: string; day: string; stats: DayStats }>();

  function bump(assetId: string, holder: string, delta: bigint): void {
    if (holder === zeroAddress) {
      return;
    }
    const key = `${assetId}|${holder}`;
    const entry = deltas.get(key) ?? { assetId, holder, delta: BigInt(0) };
    entry.delta += delta;
    deltas.set(key, entry);
  }

  for (const transfer of transfers) {
    bump(transfer.assetId, transfer.from, -transfer.value);
    bump(transfer.assetId, transfer.to, transfer.value);
    const bucket = buckets.get(transfer.blockNumber);
    if (!bucket) throw new Error("Missing ledger activity bucket; checkpoint retained");
    const day = bucket.day;
    const key = `${transfer.assetId}:${day}`;
    const entry = days.get(key) ?? { assetId: transfer.assetId, day, stats: emptyStats() };
    entry.stats.transfers += 1;
    entry.stats.volume += transfer.value;
    if (transfer.from === zeroAddress) {
      entry.stats.mints += 1;
    }
    if (transfer.to === zeroAddress) {
      entry.stats.burns += 1;
    }
    if (!settlementIds.has(transfer.assetId) && settledTxs.has(transfer.txHash)) {
      entry.stats.dvp += 1;
    }
    if (!bucket.marketOpen) {
      entry.stats.offhours += 1;
    }
    days.set(key, entry);
  }
  await writeBalances(executor, deltas, toBlock);
  await writeActivity(executor, days);
}

async function scanRange(chainId: number, assets: TrackedAsset[], from: bigint, to: bigint, label: string, checkpoint: boolean, applyIds: Set<string> | null = null): Promise<number> {
  const byAddress = new Map(assets.map((asset) => [asset.address.toLowerCase(), asset]));
  const settlementIds = new Set(assets.filter((asset) => asset.assetType === "stablecoin").map((asset) => asset.id));
  let applied = 0;
  await scanLogs({
    client: l2Client(chainId),
    addresses: assets.map((asset) => asset.address as Address),
    abi: STOCK_ABI,
    eventName: "Transfer",
    range: { fromBlock: from, toBlock: to },
    chunk: LEDGER_LOG_CHUNK,
    minChunk: LEDGER_MIN_CHUNK,
    paceMs: LEDGER_PACE_MS,
    label,
    maxWindows: checkpoint ? 1 : undefined,
    onWindow: async function commit(logs, toBlock) {
      const transfers: DecodedTransfer[] = [];
      for (const log of decodeLogs(STOCK_ABI, logs)) {
        if (log.eventName !== "Transfer") {
          continue;
        }
        const asset = byAddress.get(log.address.toLowerCase());
        if (!asset) {
          continue;
        }
        const args = log.args as { from: Address; to: Address; value: bigint };
        transfers.push({ assetId: asset.id, txHash: log.transactionHash, blockNumber: log.blockNumber, from: args.from.toLowerCase(), to: args.to.toLowerCase(), value: args.value });
      }
      // Deltas and the checkpoint land together or not at all: a restart
      // between them would apply this window twice, and deltas cannot be
      // taken back.
      const hash = checkpoint ? await blockHash(l2Client(chainId), toBlock) : null;
      const appliedTransfers = applyIds ? transfers.filter((transfer) => applyIds.has(transfer.assetId)) : transfers;
      const buckets = await activityBuckets(chainId, appliedTransfers.map((transfer) => transfer.blockNumber));
      await db.transaction(async function commitWindow(tx) {
        await applyWindow(tx, transfers, settlementIds, applyIds, toBlock, buckets);
        if (checkpoint && hash) {
          await writeCheckpoint(`${LEDGER_NAME}:${chainId}`, chainId, { blockNumber: toBlock, blockHash: hash }, tx);
        }
      });
      applied += transfers.length;
    },
  });
  return applied;
}

export async function scanTransferLedger(chainId: number): Promise<RunOutcome> {
  const assets = await ledgerAssets(chainId);
  const client = l2Client(chainId);
  const head = (await client.getBlockNumber()) - CONFIRMATIONS;
  const checkpoint = await readCheckpoint(`${LEDGER_NAME}:${chainId}`);
  let from = backfillStart();
  if (!checkpoint) {
    // A scan that starts at genesis covers every asset it carries; marking
    // them now means a restart mid-backfill resumes from the checkpoint
    // instead of re-reading each asset's history and doubling its balances.
    await markCovered(LEDGER_NAME, chainId, assets, head);
  }
  if (checkpoint) {
    const hash = await blockHash(client, checkpoint.blockNumber);
    if (hash !== checkpoint.blockHash) {
      // Deltas already applied cannot be rewound. Three hundred confirmations
      // make this a chain incident; it is logged as one and the scan goes on.
      logEvent("registry", { event: "ledger-reorg-unhandled", chainId, at: checkpoint.blockNumber.toString() });
    }
    from = checkpoint.blockNumber + BigInt(1);
  }
  // An asset listed after the checkpoint existed is not read by the head scan;
  // its own pass from genesis covers it, so no window is applied twice.
  const pending = new Set((await uncoveredAssets(LEDGER_NAME, assets)).map((asset) => asset.id));
  const covered = assets.filter((asset) => !pending.has(asset.id));
  let applied = 0;
  if (from <= head && covered.length > 0) {
    applied = await scanRange(chainId, covered, from, head, LEDGER_NAME, true);
  }
  const committed = await readCheckpoint(`${LEDGER_NAME}:${chainId}`);
  if (committed && committed.blockNumber < head) {
    return { rows: applied, detail: { from: from.toString(), head: head.toString(), committedBlock: committed.blockNumber.toString(), backfilled: 0, complete: false } };
  }
  const backfilled = await backfillNewAssets(chainId, assets, head);
  return { rows: applied + backfilled, detail: { from: from.toString(), head: head.toString(), backfilled } };
}

// Same rule as the supply scanner: an asset listed after the checkpoint
// existed is read from genesis on its own, then marked covered.
async function backfillNewAssets(chainId: number, assets: TrackedAsset[], head: bigint): Promise<number> {
  const pending = await uncoveredAssets(LEDGER_NAME, assets);
  if (pending.length === 0) {
    return 0;
  }
  const checkpoint = await readCheckpoint(`${LEDGER_NAME}:${chainId}`);
  if (!checkpoint) {
    return 0;
  }
  let applied = 0;
  for (const asset of pending) {
    const settlement = assets.filter((entry) => entry.assetType === "stablecoin" && entry.id !== asset.id);
    applied += await scanRange(chainId, [asset, ...settlement], GENESIS_SCAN_BLOCK, checkpoint.blockNumber, `ledger-backfill:${asset.symbol}`, false, new Set([asset.id]));
    await markCovered(LEDGER_NAME, chainId, [asset], head);
    logEvent("registry", { event: "asset-backfilled", scanner: LEDGER_NAME, asset: asset.symbol });
  }
  return applied;
}

export interface LedgerProgress {
  block: bigint | null;
  head: bigint | null;
  behind: bigint | null;
}

// How far the ledger trails the chain, for pages that must say "still
// reading history" rather than show a partial holder list as the truth.
export async function ledgerProgress(chainId: number): Promise<LedgerProgress> {
  const checkpoint = await readCheckpoint(`${LEDGER_NAME}:${chainId}`);
  const head = (await recordedHead(chainId))?.block ?? null;
  const block = checkpoint?.blockNumber ?? null;
  return { block, head, behind: block !== null && head !== null ? head - block : null };
}
