// Mints, burns and multiplier changes as the contracts announced them, and a
// daily reconciliation of the supply each contract reports against the sum of
// its own mints and burns. The residual is the number naive indexers get wrong
// across rebases; here it is measured and published.

import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { formatUnits, zeroAddress, type Address } from "viem";
import { db } from "@/lib/db";
import { registryMultiplierEvents, registrySupplyEvents, registrySupplySnapshots } from "@/lib/db/schema";
import { logEvent } from "@/lib/log";
import { STOCK_ABI } from "@/lib/registry/authority/abis";
import { blockHash, decodeLogs, eventId, l2Client, multicall, scanLogs } from "@/lib/registry/authority/chain";
import { backfillStart, GENESIS_SCAN_BLOCK, MULTIPLIER_LOG_CHUNK, SUPPLY_LOG_CHUNK } from "@/lib/registry/authority/constants";
import { activeAssets, patchState, type TrackedAsset } from "@/lib/registry/authority/assets";
import { emitEvents } from "@/lib/registry/authority/events";
import { readCheckpoint, writeCheckpoint, type RunOutcome } from "@/lib/registry/authority/runs";
import { markCovered, uncoveredAssets } from "@/lib/registry/authority/coverage";

const CONFIRMATIONS = BigInt(2);
const REORG_REWIND = BigInt(2_000);

// Stock Tokens and the stablecoin are issued and redeemed; wrapped ETH is
// wrapped and unwrapped, which looks the same on chain and means nothing here.
async function issuedAssets(chainId: number): Promise<TrackedAsset[]> {
  const assets = await activeAssets(chainId);
  return assets.filter(function issued(asset) {
    return asset.assetType !== "wrapped_native";
  });
}

interface ScanWindow {
  from: bigint;
  head: bigint;
}

// Shared by both scanners: where to resume, with the reorg rewind that drops
// rows past the last agreed block.
async function resolveWindow(chainId: number, name: string, dropAfter: (block: bigint) => Promise<void>): Promise<ScanWindow> {
  const client = l2Client(chainId);
  const head = (await client.getBlockNumber()) - CONFIRMATIONS;
  const checkpoint = await readCheckpoint(`${name}:${chainId}`);
  if (!checkpoint) {
    return { from: backfillStart(), head };
  }
  const hash = await blockHash(client, checkpoint.blockNumber);
  if (hash === checkpoint.blockHash) {
    return { from: checkpoint.blockNumber + BigInt(1), head };
  }
  const rewindTo = checkpoint.blockNumber > REORG_REWIND ? checkpoint.blockNumber - REORG_REWIND : GENESIS_SCAN_BLOCK;
  await dropAfter(rewindTo);
  logEvent("registry", { event: "reorg", job: name, chainId, at: checkpoint.blockNumber.toString(), rewindTo: rewindTo.toString() });
  return { from: rewindTo + BigInt(1), head };
}

async function finishWindow(chainId: number, name: string, head: bigint): Promise<void> {
  await writeCheckpoint(`${name}:${chainId}`, chainId, { blockNumber: head, blockHash: await blockHash(l2Client(chainId), head) });
}

interface SupplyScan {
  kind: "mint" | "burn";
  args: Record<string, unknown>;
}

const SUPPLY_SCANS: SupplyScan[] = [
  { kind: "mint", args: { from: zeroAddress } },
  { kind: "burn", args: { to: zeroAddress } },
];

// One kind at a time, each with its own checkpoint, each window written and
// checkpointed before the next is read. A first run over the chain's history
// takes minutes on the public RPC; this is what lets it be interrupted.
async function scanSupplyKind(chainId: number, scan: SupplyScan, assets: TrackedAsset[]): Promise<{ inserted: number; from: bigint; head: bigint }> {
  const name = `supply-${scan.kind}`;
  const window = await resolveWindow(chainId, name, async function drop(block) {
    await db
      .delete(registrySupplyEvents)
      .where(and(eq(registrySupplyEvents.chainId, chainId), eq(registrySupplyEvents.kind, scan.kind), gt(registrySupplyEvents.blockNumber, block)));
  });
  if (window.from > window.head) {
    return { inserted: 0, from: window.from, head: window.head };
  }
  const inserted = await scanSupplyRange(chainId, scan, assets, window, name, true);
  return { inserted, from: window.from, head: window.head };
}

// The log scan itself, shared by the head scanner and the per-asset backfill.
// Only the head scanner moves the kind's checkpoint.
async function scanSupplyRange(chainId: number, scan: SupplyScan, assets: TrackedAsset[], window: ScanWindow, name: string, checkpoint: boolean): Promise<number> {
  const byAddress = new Map(assets.map((asset) => [asset.address.toLowerCase(), asset]));
  let inserted = 0;
  await scanLogs({
    client: l2Client(chainId),
    addresses: assets.map((asset) => asset.address as Address),
    abi: STOCK_ABI,
    eventName: "Transfer",
    args: scan.args,
    range: { fromBlock: window.from, toBlock: window.head },
    chunk: SUPPLY_LOG_CHUNK,
    label: name,
    onWindow: async function commit(logs, toBlock) {
      const rows = decodeLogs(STOCK_ABI, logs)
        .filter(function transfers(log) {
          return log.eventName === "Transfer";
        })
        .map(function shape(log) {
          const args = log.args as { from: Address; to: Address; value: bigint };
          return {
            id: eventId(chainId, log.transactionHash, log.logIndex),
            assetId: byAddress.get(log.address.toLowerCase())?.id ?? null,
            chainId,
            address: log.address.toLowerCase(),
            blockNumber: log.blockNumber,
            txHash: log.transactionHash,
            logIndex: log.logIndex,
            kind: scan.kind,
            counterparty: (scan.kind === "mint" ? args.to : args.from).toLowerCase(),
            valueRaw: args.value.toString(),
          };
        });
      for (let startAt = 0; startAt < rows.length; startAt += 500) {
        const result = await db.insert(registrySupplyEvents).values(rows.slice(startAt, startAt + 500)).onConflictDoNothing().returning({ id: registrySupplyEvents.id });
        inserted += result.length;
      }
      if (checkpoint) {
        await finishWindow(chainId, name, toBlock);
      }
    },
  });
  return inserted;
}

const SUPPLY_COVERAGE = "supply";

// An asset listed after the scanners' checkpoints existed (a bridged coin
// found today) has history the head scan never saw: read it from genesis up
// to the checkpoint, one asset at a time, then mark it covered. On a fresh
// database the head scan itself started at genesis, so everything it carried
// is covered once it reaches head.
async function backfillNewAssets(chainId: number, assets: TrackedAsset[], head: bigint): Promise<number> {
  const pending = await uncoveredAssets(SUPPLY_COVERAGE, assets);
  if (pending.length === 0) {
    return 0;
  }
  const mintCheckpoint = await readCheckpoint(`supply-mint:${chainId}`);
  const burnCheckpoint = await readCheckpoint(`supply-burn:${chainId}`);
  if (!mintCheckpoint || !burnCheckpoint) {
    return 0;
  }
  let inserted = 0;
  for (const asset of pending) {
    for (const scan of SUPPLY_SCANS) {
      const upTo = scan.kind === "mint" ? mintCheckpoint.blockNumber : burnCheckpoint.blockNumber;
      inserted += await scanSupplyRange(chainId, scan, [asset], { from: GENESIS_SCAN_BLOCK, head: upTo }, `supply-backfill:${asset.symbol}`, false);
    }
    await markCovered(SUPPLY_COVERAGE, chainId, [asset], head);
    logEvent("registry", { event: "asset-backfilled", scanner: SUPPLY_COVERAGE, asset: asset.symbol, rows: inserted });
  }
  return inserted;
}

export async function scanSupplyEvents(chainId: number): Promise<RunOutcome> {
  const assets = await issuedAssets(chainId);
  if ((await readCheckpoint(`supply-mint:${chainId}`)) === null) {
    // A scan from genesis covers every asset it carries; marked before it
    // starts so a restart mid-backfill does not re-read them one by one.
    await markCovered(SUPPLY_COVERAGE, chainId, assets, GENESIS_SCAN_BLOCK);
  }
  const mints = await scanSupplyKind(chainId, SUPPLY_SCANS[0], assets);
  const burns = await scanSupplyKind(chainId, SUPPLY_SCANS[1], assets);
  const backfilled = await backfillNewAssets(chainId, assets, burns.head);
  return {
    rows: mints.inserted + burns.inserted + backfilled,
    detail: { from: mints.from.toString(), head: burns.head.toString(), mints: mints.inserted, burns: burns.inserted, backfilled },
  };
}

export async function scanMultiplierEvents(chainId: number): Promise<RunOutcome> {
  const name = "multiplier-events";
  const announcing = (await readCheckpoint(`${name}:${chainId}`)) !== null;
  const window = await resolveWindow(chainId, name, async function drop(block) {
    await db.delete(registryMultiplierEvents).where(and(eq(registryMultiplierEvents.chainId, chainId), gt(registryMultiplierEvents.blockNumber, block)));
  });
  if (window.from > window.head) {
    return { rows: 0, detail: { head: window.head.toString() } };
  }
  const assets = await activeAssets(chainId, "stock_token");
  const byAddress = new Map(assets.map((asset) => [asset.address.toLowerCase(), asset]));
  const logs = await scanLogs({
    client: l2Client(chainId),
    addresses: assets.map((asset) => asset.address as Address),
    abi: STOCK_ABI,
    eventName: "UIMultiplierUpdated",
    range: { fromBlock: window.from, toBlock: window.head },
    chunk: MULTIPLIER_LOG_CHUNK,
    label: name,
  });
  const rows = decodeLogs(STOCK_ABI, logs)
    .filter(function multipliers(log) {
      return log.eventName === "UIMultiplierUpdated";
    })
    .map(function shape(log) {
      const args = log.args as { oldMultiplier: bigint; newMultiplier: bigint; effectiveAtTimestamp: bigint };
      return {
        id: eventId(chainId, log.transactionHash, log.logIndex),
        assetId: byAddress.get(log.address.toLowerCase())?.id ?? null,
        chainId,
        address: log.address.toLowerCase(),
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
        logIndex: log.logIndex,
        oldMultiplier: formatUnits(args.oldMultiplier, 18),
        newMultiplier: formatUnits(args.newMultiplier, 18),
        effectiveAt: new Date(Number(args.effectiveAtTimestamp) * 1000),
      };
    });
  let inserted = 0;
  if (rows.length > 0) {
    const result = await db.insert(registryMultiplierEvents).values(rows).onConflictDoNothing().returning({ id: registryMultiplierEvents.id });
    inserted = result.length;
    const insertedIds = new Set(result.map((row) => row.id));
    const fresh = announcing ? rows.filter((row) => insertedIds.has(row.id)) : [];
    const times = new Map<bigint, Date>();
    for (const row of fresh) {
      if (!times.has(row.blockNumber)) {
        const block = await l2Client(chainId).getBlock({ blockNumber: row.blockNumber });
        times.set(row.blockNumber, new Date(Number(block.timestamp) * 1000));
      }
    }
    await emitEvents(
      fresh
        .map(function toEvent(row) {
          const asset = byAddress.get(row.address);
          return {
            chainId,
            kind: "multiplier.scheduled" as const,
            assetId: row.assetId,
            address: row.address,
            symbol: asset?.symbol ?? null,
            key: `${row.txHash}:${row.logIndex}`,
            txHash: row.txHash,
            blockNumber: row.blockNumber,
            detail: { from: Number(row.oldMultiplier), to: Number(row.newMultiplier), effectiveAt: row.effectiveAt.toISOString() },
            occurredAt: times.get(row.blockNumber) ?? new Date(),
          };
        }),
    );
  }
  await finishWindow(chainId, name, window.head);
  return { rows: inserted, detail: { from: window.from.toString(), head: window.head.toString() } };
}

// Once a day: for every asset, the contract's totalSupply against everything
// ever minted minus everything ever burned. Cumulative, not per day, because
// the reconciliation is exact only over the whole history.
// A reconciliation is only meaningful once every mint and burn up to head is on
// record. While a scanner is still backfilling, the day's snapshot is skipped
// rather than published with a residual that only says "not finished yet".
const SNAPSHOT_MAX_LAG = BigInt(10_000);

async function scannersAtHead(chainId: number, head: bigint): Promise<boolean> {
  for (const name of ["supply-mint", "supply-burn"]) {
    const checkpoint = await readCheckpoint(`${name}:${chainId}`);
    if (!checkpoint || head - checkpoint.blockNumber > SNAPSHOT_MAX_LAG) {
      return false;
    }
  }
  return true;
}

// A residual appearing, or clearing, is news; the same residual standing for
// another day is not. Compared against the latest earlier snapshot.
async function emitResidualChange(asset: TrackedAsset, day: string, residual: bigint): Promise<void> {
  const previous = await db
    .select({ residualRaw: registrySupplySnapshots.residualRaw })
    .from(registrySupplySnapshots)
    .where(and(eq(registrySupplySnapshots.assetId, asset.id), lt(registrySupplySnapshots.day, day)))
    .orderBy(desc(registrySupplySnapshots.day))
    .limit(1);
  const before = previous[0] ? BigInt(previous[0].residualRaw) : null;
  if (before === null) {
    return;
  }
  const hadResidual = before !== BigInt(0);
  const hasResidual = residual !== BigInt(0);
  if (hadResidual === hasResidual) {
    return;
  }
  await emitEvents([
    {
      chainId: asset.chainId,
      kind: hasResidual ? "supply.residual" : "supply.reconciled",
      assetId: asset.id,
      address: asset.address.toLowerCase(),
      symbol: asset.symbol,
      key: day,
      detail: { day, residual: formatUnits(residual, asset.decimals), residualRaw: residual.toString() },
      occurredAt: new Date(),
    },
  ]);
}

export async function snapshotSupply(chainId: number): Promise<RunOutcome> {
  const assets = await issuedAssets(chainId);
  const client = l2Client(chainId);
  const head = await client.getBlockNumber();
  if (!(await scannersAtHead(chainId, head))) {
    return { rows: 0, detail: { skipped: "supply scanners are still behind head" } };
  }
  const supplies = await multicall(
    client,
    assets.map(function call(asset) {
      return { address: asset.address, abi: STOCK_ABI, functionName: "totalSupply" };
    }),
  );
  const day = new Date().toISOString().slice(0, 10);
  let written = 0;
  let mismatched = 0;
  for (const [index, asset] of assets.entries()) {
    const supply = supplies[index];
    if (supply.status !== "success" || typeof supply.result !== "bigint") {
      continue;
    }
    const sums = await db
      .select({
        minted: sql<string>`coalesce(sum(${registrySupplyEvents.valueRaw}) filter (where ${registrySupplyEvents.kind} = 'mint'), 0)`,
        burned: sql<string>`coalesce(sum(${registrySupplyEvents.valueRaw}) filter (where ${registrySupplyEvents.kind} = 'burn'), 0)`,
      })
      .from(registrySupplyEvents)
      .where(eq(registrySupplyEvents.assetId, asset.id));
    const minted = BigInt(sums[0]?.minted ?? "0");
    const burned = BigInt(sums[0]?.burned ?? "0");
    const residual = supply.result - (minted - burned);
    if (residual !== BigInt(0)) {
      mismatched += 1;
    }
    await emitResidualChange(asset, day, residual);
    await db
      .insert(registrySupplySnapshots)
      .values({
        id: `${asset.id}:${day}`,
        assetId: asset.id,
        day,
        totalSupplyRaw: supply.result.toString(),
        mintedRaw: minted.toString(),
        burnedRaw: burned.toString(),
        residualRaw: residual.toString(),
        headBlock: head,
      })
      .onConflictDoUpdate({
        target: registrySupplySnapshots.id,
        set: { totalSupplyRaw: supply.result.toString(), mintedRaw: minted.toString(), burnedRaw: burned.toString(), residualRaw: residual.toString(), headBlock: head, takenAt: new Date() },
      });
    written += 1;
  }
  return { rows: written, detail: { day, mismatched } };
}

export type { TrackedAsset };
export { patchState };
