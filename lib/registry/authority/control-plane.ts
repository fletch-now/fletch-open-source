// The issuer's control plane: every event on AccessControlsRegistry since the
// last checkpoint, the contract's answers at head, and a blocked count derived
// from the events themselves. One address filter, so it is cheap to run often.

import { and, eq, gt, sql } from "drizzle-orm";
import type { Address, PublicClient } from "viem";
import { db } from "@/lib/db";
import { registryControlEvents, registryControlState } from "@/lib/db/schema";
import { emitEvents, type AuthorityEventKind } from "@/lib/registry/authority/events";
import { logEvent } from "@/lib/log";
import { REGISTRY_ABI } from "@/lib/registry/authority/abis";
import { blockHash, decodeLogs, eventId, l2Client, multicall, scanLogs } from "@/lib/registry/authority/chain";
import { ACCESS_CONTROLS_REGISTRY, backfillStart, CONTROL_LOG_CHUNK, GENESIS_SCAN_BLOCK } from "@/lib/registry/authority/constants";
import { readCheckpoint, writeCheckpoint, type RunOutcome } from "@/lib/registry/authority/runs";

const CHECKPOINT = "control-plane";
// Blocks are soft-confirmed at once; two behind head is enough to avoid
// re-reading a block the sequencer is still assembling.
const CONFIRMATIONS = BigInt(2);
const REORG_REWIND = BigInt(2_000);

const EVENTS = ["Blocked", "Unblocked", "Paused", "Unpaused", "Upgraded", "RoleGranted", "RoleRevoked", "RoleAdminChanged"] as const;

interface DecodedRow {
  id: string;
  chainId: number;
  blockNumber: bigint;
  blockHash: string;
  txHash: string;
  logIndex: number;
  event: string;
  account: string | null;
  role: string | null;
  implementation: string | null;
}

function toRow(chainId: number, log: { eventName: string; args?: Record<string, unknown>; blockNumber: bigint; blockHash: string; transactionHash: string; logIndex: number }): DecodedRow {
  // Paused() and Unpaused() have no arguments, and the decoder hands back no
  // args object at all for them.
  const args = log.args ?? {};
  const account = typeof args.account === "string" ? args.account.toLowerCase() : null;
  const role = typeof args.role === "string" ? args.role : null;
  const implementation = typeof args.implementation === "string" ? args.implementation.toLowerCase() : null;
  return {
    id: eventId(chainId, log.transactionHash, log.logIndex),
    chainId,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    txHash: log.transactionHash,
    logIndex: log.logIndex,
    event: log.eventName,
    account,
    role,
    implementation,
  };
}

const EVENT_KIND: Record<string, AuthorityEventKind> = {
  Blocked: "registry.blocked",
  Unblocked: "registry.unblocked",
  Paused: "registry.paused",
  Unpaused: "registry.unpaused",
  Upgraded: "registry.upgraded",
  RoleGranted: "registry.role",
  RoleRevoked: "registry.role",
  RoleAdminChanged: "registry.role",
};

// Block timestamps are fetched only for blocks that carry a new event: a few a
// day once caught up. A backfill with more distinct blocks than this cap keeps
// the observation time instead of spending the RPC budget on history.
const TIMESTAMP_LOOKUP_CAP = 50;

async function blockTimes(chainId: number, rows: DecodedRow[]): Promise<Map<bigint, Date>> {
  const blocks = [...new Set(rows.map((row) => row.blockNumber))];
  const times = new Map<bigint, Date>();
  if (blocks.length > TIMESTAMP_LOOKUP_CAP) {
    return times;
  }
  const client = l2Client(chainId);
  for (const blockNumber of blocks) {
    const block = await client.getBlock({ blockNumber });
    times.set(blockNumber, new Date(Number(block.timestamp) * 1000));
  }
  return times;
}

async function emitControlEvents(chainId: number, rows: DecodedRow[]): Promise<void> {
  const times = await blockTimes(chainId, rows);
  await emitEvents(
    rows.map(function toEvent(row) {
      return {
        chainId,
        kind: EVENT_KIND[row.event] ?? "registry.role",
        address: ACCESS_CONTROLS_REGISTRY.toLowerCase(),
        key: `${row.txHash}:${row.logIndex}`,
        txHash: row.txHash,
        blockNumber: row.blockNumber,
        detail: { event: row.event, account: row.account, role: row.role, implementation: row.implementation },
        occurredAt: times.get(row.blockNumber) ?? new Date(),
      };
    }),
  );
}

// A checkpoint whose block hash no longer matches means the chain reorganised
// under it. The scan rewinds and the events past the rewind point are dropped;
// they are re-read from the canonical chain on this same run.
async function resolveStart(chainId: number, client: PublicClient): Promise<bigint> {
  const checkpoint = await readCheckpoint(`${CHECKPOINT}:${chainId}`);
  if (!checkpoint) {
    return backfillStart();
  }
  const hash = await blockHash(client, checkpoint.blockNumber);
  if (hash === checkpoint.blockHash) {
    return checkpoint.blockNumber + BigInt(1);
  }
  const rewindTo = checkpoint.blockNumber > REORG_REWIND ? checkpoint.blockNumber - REORG_REWIND : GENESIS_SCAN_BLOCK;
  await db.delete(registryControlEvents).where(and(eq(registryControlEvents.chainId, chainId), gt(registryControlEvents.blockNumber, rewindTo)));
  logEvent("registry", { event: "reorg", job: CHECKPOINT, chainId, at: checkpoint.blockNumber.toString(), rewindTo: rewindTo.toString() });
  return rewindTo + BigInt(1);
}

async function readRegistryAtHead(client: PublicClient): Promise<{ implementation: string; paused: boolean; observedAt: Date }> {
  const [implementation, paused] = await multicall(client, [
    { address: ACCESS_CONTROLS_REGISTRY, abi: REGISTRY_ABI, functionName: "implementation" },
    { address: ACCESS_CONTROLS_REGISTRY, abi: REGISTRY_ABI, functionName: "paused" },
  ]);
  if (implementation.status !== "success" || paused.status !== "success") {
    throw new Error("Control-plane state read failed; previous observation retained");
  }
  return { implementation: String(implementation.result).toLowerCase(), paused: Boolean(paused.result), observedAt: new Date() };
}

export interface ControlPlaneReads {
  client?: PublicClient;
  scan?: typeof scanLogs;
}

export async function scanControlPlane(chainId: number, reads: ControlPlaneReads = {}): Promise<RunOutcome> {
  const client = reads.client ?? l2Client(chainId);
  const scan = reads.scan ?? scanLogs;
  const phaseMs: Record<string, number> = {};
  async function measured<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try { return await work(); }
    finally { phaseMs[phase] = Date.now() - started; }
  }
  // The first pass over the registry's history is a baseline, not news.
  const announcing = (await readCheckpoint(`${CHECKPOINT}:${chainId}`)) !== null;
  // Independent reads enter the same paced queue together. Serializing each
  // behind all other jobs multiplied queue latency without saving any calls.
  const [tip, from, atHead] = await Promise.all([
    measured("head", () => client.getBlockNumber()),
    measured("checkpoint", () => resolveStart(chainId, client)),
    measured("state", () => readRegistryAtHead(client)),
  ]);
  const head = tip - CONFIRMATIONS;
  let inserted = 0;
  if (from <= head) {
    // One address and a few hundred events over the chain's whole history: a
    // single filter the public RPC answers in one call, narrowed only if refused.
    const [all, headHash] = await Promise.all([measured("logs", () => scan({
      client,
      addresses: [ACCESS_CONTROLS_REGISTRY as Address],
      abi: REGISTRY_ABI,
      eventName: [...EVENTS],
      range: { fromBlock: from, toBlock: head },
      chunk: CONTROL_LOG_CHUNK,
      label: CHECKPOINT,
    })), measured("headHash", () => blockHash(client, head))]);
    const rows = decodeLogs(REGISTRY_ABI, all).map(function shape(log) {
      return toRow(chainId, log as never);
    });
    if (rows.length > 0) {
      const result = await db.insert(registryControlEvents).values(rows).onConflictDoNothing().returning({ id: registryControlEvents.id });
      inserted = result.length;
      const insertedIds = new Set(result.map((row) => row.id));
      if (announcing) {
        await emitControlEvents(chainId, rows.filter((row) => insertedIds.has(row.id)));
      }
    }
    await writeCheckpoint(`${CHECKPOINT}:${chainId}`, chainId, { blockNumber: head, blockHash: headHash });
  }

  const counts = await db
    .select({
      blocked: sql<number>`count(*) filter (where ${registryControlEvents.event} = 'Blocked')`,
      unblocked: sql<number>`count(*) filter (where ${registryControlEvents.event} = 'Unblocked')`,
      lastBlock: sql<string>`coalesce(max(${registryControlEvents.blockNumber}), 0)`,
    })
    .from(registryControlEvents)
    .where(eq(registryControlEvents.chainId, chainId));
  const tally = counts[0];
  const blockedCount = Number(tally?.blocked ?? 0) - Number(tally?.unblocked ?? 0);
  await db
    .insert(registryControlState)
    .values({
      chainId,
      registryAddress: ACCESS_CONTROLS_REGISTRY.toLowerCase(),
      implementation: atHead.implementation,
      paused: atHead.paused,
      blockedCount,
      lastEventBlock: BigInt(tally?.lastBlock ?? 0),
      checkedAt: atHead.observedAt,
    })
    .onConflictDoUpdate({
      target: registryControlState.chainId,
      set: {
        implementation: atHead.implementation,
        paused: atHead.paused,
        blockedCount,
        lastEventBlock: BigInt(tally?.lastBlock ?? 0),
        checkedAt: atHead.observedAt,
      },
    });
  return { rows: inserted, detail: { head: head.toString(), from: from.toString(), blockedCount, paused: atHead.paused, stateObservedAt: atHead.observedAt.toISOString(), phaseMs } };
}
