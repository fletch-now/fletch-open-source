// The token bridge, both directions. Flows come from the L2 gateways'
// events, with block timestamps because there are only a few a day; escrow
// comes from the L1 gateway's balance of each L1 token, read through
// Multicall3 on Ethereum, and is compared with the L2 supply. L1 log history
// needs an archive node this deployment does not have, so a withdrawal's
// execution is not recorded per flow; the escrow gap carries that total.

import { and, desc, eq, gt, sql } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { bridgeEscrow, bridgeFlows, registryAssetState } from "@/lib/db/schema";
import { ERC20_BALANCE_ABI, L1_GATEWAY_ROUTER_ABI, L2_GATEWAY_ABI } from "@/lib/registry/authority/abis";
import { activeAssets, type TrackedAsset } from "@/lib/registry/authority/assets";
import { blockHash, decodeLogs, eventId, l1Client, l2Client, multicall, scanLogs } from "@/lib/registry/authority/chain";
import { backfillStart, BRIDGE_LOG_CHUNK, L1_GATEWAY_ROUTER, L2_CUSTOM_GATEWAY, L2_ERC20_GATEWAY, WITHDRAWAL_WINDOW_SECONDS } from "@/lib/registry/authority/constants";
import { emitEvents, type AuthorityEventInput } from "@/lib/registry/authority/events";
import { lastFinishedRunOf, readCheckpoint, writeCheckpoint, type RunOutcome } from "@/lib/registry/authority/runs";

const FLOWS_NAME = "bridge-flows";
const CONFIRMATIONS = BigInt(30);
const TIMESTAMP_LOOKUP_CAP = 200;

export type BridgeFlow = typeof bridgeFlows.$inferSelect;
export type BridgeEscrowRow = typeof bridgeEscrow.$inferSelect;

interface DecodedFlow {
  direction: "deposit" | "withdrawal";
  l1Token: string;
  from: string;
  to: string;
  amount: bigint;
  l2ToL1Id: bigint | null;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
}

// Bridged rows carry their L1 token in raw.l1Address, written by the bridged
// job from the same router that names the gateway here.
async function bridgedByL1Token(chainId: number): Promise<Map<string, TrackedAsset & { l1Token: string }>> {
  const assets = await activeAssets(chainId, "bridged");
  const rows = await db.execute<{ id: string; l1: string | null }>(sql`select id, raw->>'l1Address' as l1 from registry_assets where chain_id = ${chainId} and asset_type = 'bridged'`);
  const l1ById = new Map(rows.rows.map((row) => [row.id, row.l1?.toLowerCase() ?? null]));
  const map = new Map<string, TrackedAsset & { l1Token: string }>();
  for (const asset of assets) {
    const l1Token = l1ById.get(asset.id);
    if (l1Token) {
      map.set(l1Token, { ...asset, l1Token });
    }
  }
  return map;
}

function decodeFlow(log: ReturnType<typeof decodeLogs<typeof L2_GATEWAY_ABI>>[number]): DecodedFlow | null {
  if (log.eventName === "DepositFinalized") {
    const args = log.args as { l1Token: Address; _from: Address; _to: Address; _amount: bigint };
    return { direction: "deposit", l1Token: args.l1Token.toLowerCase(), from: args._from.toLowerCase(), to: args._to.toLowerCase(), amount: args._amount, l2ToL1Id: null, blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
  }
  if (log.eventName === "WithdrawalInitiated") {
    const args = log.args as { l1Token: Address; _from: Address; _to: Address; _l2ToL1Id: bigint; _exitNum: bigint; _amount: bigint };
    return { direction: "withdrawal", l1Token: args.l1Token.toLowerCase(), from: args._from.toLowerCase(), to: args._to.toLowerCase(), amount: args._amount, l2ToL1Id: args._l2ToL1Id, blockNumber: log.blockNumber, txHash: log.transactionHash, logIndex: log.logIndex };
  }
  return null;
}

async function blockTimes(chainId: number, blocks: bigint[]): Promise<Map<bigint, Date>> {
  const distinct = [...new Set(blocks)].slice(0, TIMESTAMP_LOOKUP_CAP);
  const times = new Map<bigint, Date>();
  const client = l2Client(chainId);
  for (let start = 0; start < distinct.length; start += 10) {
    const batch = distinct.slice(start, start + 10);
    const results = await Promise.all(batch.map((blockNumber) => client.getBlock({ blockNumber })));
    results.forEach(function keep(block, index) {
      times.set(batch[index], new Date(Number(block.timestamp) * 1000));
    });
  }
  return times;
}

export async function scanBridgeFlows(chainId: number): Promise<RunOutcome> {
  const client = l2Client(chainId);
  const head = (await client.getBlockNumber()) - CONFIRMATIONS;
  const checkpoint = await readCheckpoint(`${FLOWS_NAME}:${chainId}`);
  const from = checkpoint ? checkpoint.blockNumber + BigInt(1) : backfillStart();
  if (from > head) {
    return { rows: 0, detail: { head: head.toString() } };
  }
  const byL1 = await bridgedByL1Token(chainId);
  // The first complete pass is history, not news: announcements start once
  // a previous run has finished, whatever windows a cut-off run committed.
  const announcing = (await lastFinishedRunOf(FLOWS_NAME))?.ok === true;
  let inserted = 0;
  const announced: AuthorityEventInput[] = [];
  await scanLogs({
    client,
    addresses: [L2_ERC20_GATEWAY, L2_CUSTOM_GATEWAY],
    abi: L2_GATEWAY_ABI,
    eventName: ["DepositFinalized", "WithdrawalInitiated"],
    range: { fromBlock: from, toBlock: head },
    chunk: BRIDGE_LOG_CHUNK,
    label: FLOWS_NAME,
    onWindow: async function commit(logs, toBlock) {
      const flows = decodeLogs(L2_GATEWAY_ABI, logs).map(decodeFlow).filter((flow): flow is DecodedFlow => flow !== null);
      if (flows.length > 0) {
        const times = await blockTimes(chainId, flows.map((flow) => flow.blockNumber));
        const rows = flows.map(function shape(flow) {
          const asset = byL1.get(flow.l1Token) ?? null;
          const occurredAt = times.get(flow.blockNumber) ?? new Date();
          return {
            id: eventId(chainId, flow.txHash, flow.logIndex),
            chainId,
            direction: flow.direction,
            l1Token: flow.l1Token,
            assetId: asset?.id ?? null,
            fromAddress: flow.from,
            toAddress: flow.to,
            amountRaw: flow.amount.toString(),
            l2ToL1Id: flow.l2ToL1Id === null ? null : flow.l2ToL1Id.toString(),
            blockNumber: flow.blockNumber,
            txHash: flow.txHash,
            logIndex: flow.logIndex,
            occurredAt,
            claimableAt: flow.direction === "withdrawal" ? new Date(occurredAt.getTime() + WITHDRAWAL_WINDOW_SECONDS * 1000) : null,
          };
        });
        const written = await db.insert(bridgeFlows).values(rows).onConflictDoNothing().returning({ id: bridgeFlows.id });
        inserted += written.length;
        const writtenIds = new Set(written.map((row) => row.id));
        for (const row of rows) {
          const asset = byL1.get(row.l1Token);
          if (!writtenIds.has(row.id) || !asset || !announcing) {
            continue;
          }
          announced.push({
            chainId,
            kind: row.direction === "deposit" ? "bridge.deposit" : "bridge.withdrawal",
            assetId: asset.id,
            address: asset.address.toLowerCase(),
            symbol: asset.symbol,
            key: `${row.txHash}:${row.logIndex}`,
            txHash: row.txHash,
            blockNumber: row.blockNumber,
            detail: { amountRaw: row.amountRaw, decimals: asset.decimals, from: row.fromAddress, to: row.toAddress, claimableAt: row.claimableAt?.toISOString() ?? null },
            occurredAt: row.occurredAt,
          });
        }
      }
      await writeCheckpoint(`${FLOWS_NAME}:${chainId}`, chainId, { blockNumber: toBlock, blockHash: await blockHash(client, toBlock) });
    },
  });
  await emitEvents(announced);
  return { rows: inserted, detail: { from: from.toString(), head: head.toString(), announced: announced.length } };
}

const gatewayCache = new Map<string, Address>();

async function gatewayFor(l1Token: string): Promise<Address> {
  const cached = gatewayCache.get(l1Token);
  if (cached) {
    return cached;
  }
  const gateway = await l1Client().readContract({ address: L1_GATEWAY_ROUTER, abi: L1_GATEWAY_ROUTER_ABI, functionName: "getGateway", args: [l1Token as Address] });
  gatewayCache.set(l1Token, gateway);
  return gateway;
}

export async function refreshBridgeEscrow(chainId: number): Promise<RunOutcome> {
  const byL1 = await bridgedByL1Token(chainId);
  const entries = [...byL1.values()];
  if (entries.length === 0) {
    return { rows: 0, detail: { bridged: 0 } };
  }
  const gateways = new Map<string, Address>();
  for (const entry of entries) {
    gateways.set(entry.l1Token, await gatewayFor(entry.l1Token));
  }
  const balances = await multicall(
    l1Client(),
    entries.map(function call(entry) {
      return { address: entry.l1Token as Address, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [gateways.get(entry.l1Token) as Address] };
    }),
  );
  let written = 0;
  for (const [index, entry] of entries.entries()) {
    const result = balances[index];
    if (result.status !== "success" || typeof result.result !== "bigint") {
      continue;
    }
    const state = await db.select({ supply: registryAssetState.totalSupplyRaw }).from(registryAssetState).where(eq(registryAssetState.assetId, entry.id)).limit(1);
    const supply = state[0]?.supply ? BigInt(state[0].supply.split(".")[0]) : null;
    const escrow = result.result;
    await db
      .insert(bridgeEscrow)
      .values({
        assetId: entry.id,
        chainId,
        l1Token: entry.l1Token,
        l1Gateway: (gateways.get(entry.l1Token) as string).toLowerCase(),
        escrowRaw: escrow.toString(),
        l2SupplyRaw: supply === null ? null : supply.toString(),
        inFlightRaw: supply === null ? null : (escrow - supply).toString(),
        checkedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: bridgeEscrow.assetId,
        set: { escrowRaw: escrow.toString(), l2SupplyRaw: supply === null ? null : supply.toString(), inFlightRaw: supply === null ? null : (escrow - supply).toString(), checkedAt: new Date() },
      });
    written += 1;
  }
  return { rows: written, detail: { bridged: entries.length } };
}

export async function bridgeFlowsFor(assetId: string, limit = 50): Promise<BridgeFlow[]> {
  return db.select().from(bridgeFlows).where(eq(bridgeFlows.assetId, assetId)).orderBy(desc(bridgeFlows.occurredAt)).limit(limit);
}

export async function recentBridgeFlows(chainId: number, limit = 100): Promise<BridgeFlow[]> {
  return db.select().from(bridgeFlows).where(eq(bridgeFlows.chainId, chainId)).orderBy(desc(bridgeFlows.occurredAt)).limit(Math.min(500, limit));
}

export async function bridgeEscrowFor(assetId: string): Promise<BridgeEscrowRow | null> {
  const rows = await db.select().from(bridgeEscrow).where(eq(bridgeEscrow.assetId, assetId)).limit(1);
  return rows[0] ?? null;
}

export async function bridgeEscrowAll(chainId: number): Promise<BridgeEscrowRow[]> {
  return db.select().from(bridgeEscrow).where(eq(bridgeEscrow.chainId, chainId));
}

// Withdrawals whose window has passed in the last thirty days, for the
// bridge overview: what could be claimed on L1 now.
export async function claimableWithdrawals(chainId: number): Promise<BridgeFlow[]> {
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db
    .select()
    .from(bridgeFlows)
    .where(and(eq(bridgeFlows.chainId, chainId), eq(bridgeFlows.direction, "withdrawal"), gt(bridgeFlows.occurredAt, since)))
    .orderBy(desc(bridgeFlows.occurredAt))
    .limit(200);
}
