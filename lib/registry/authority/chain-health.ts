// The chain's vital signs from three independent sources: the L2 RPC, the
// rollup's Ethereum contracts, and the operator's status page. Any one of them
// can fail on a run; the row records what answered.

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { emitEvents } from "@/lib/registry/authority/events";
import { chainHealth } from "@/lib/db/schema";
import { ARB_PRECOMPILE_ABI, BRIDGE_ABI, ROLLUP_BOLD_ABI, SEQUENCER_INBOX_ABI } from "@/lib/registry/authority/abis";
import { l1Client, l2Client } from "@/lib/registry/authority/chain";
import { ARB_OWNER_PUBLIC, ARB_SYS, ARBOS_VERSION_OFFSET, L1_BATCH_POSTER, L1_BRIDGE, L1_ROLLUP, L1_SEQUENCER_INBOX, STATUS_PAGE_COMPONENTS } from "@/lib/registry/authority/constants";
import type { RunOutcome } from "@/lib/registry/authority/runs";

interface RawBlock {
  number: `0x${string}`;
  timestamp: `0x${string}`;
  baseFeePerGas?: `0x${string}`;
  l1BlockNumber?: `0x${string}`;
}

// Ten blocks back is about a second on this chain: enough to average the
// block time without reaching into history.
const BLOCK_TIME_SAMPLE = 10;

async function rawBlock(chainId: number, tag: string): Promise<RawBlock> {
  const client = l2Client(chainId);
  return client.request({ method: "eth_getBlockByNumber", params: [tag as `0x${string}`, false] }) as Promise<RawBlock>;
}

async function statusPage(): Promise<string | null> {
  try {
    const response = await fetch(STATUS_PAGE_COMPONENTS, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) {
      return `http ${response.status}`;
    }
    const body = (await response.json()) as { components?: Array<{ name: string; status: string }> };
    const chain = body.components?.find((component) => /robinhood chain$/i.test(component.name));
    return chain?.status ?? null;
  } catch {
    return null;
  }
}

interface Finality {
  assertion: string | null;
  createdAtL1Block: bigint | null;
  ageSeconds: number | null;
}

// The latest assertion Ethereum has confirmed and how old it is: the
// distance between "the sequencer said so" and "Ethereum agrees".
async function finality(): Promise<Finality> {
  const client = l1Client();
  try {
    const assertion = await client.readContract({ address: L1_ROLLUP, abi: ROLLUP_BOLD_ABI, functionName: "latestConfirmed" });
    const node = await client.readContract({ address: L1_ROLLUP, abi: ROLLUP_BOLD_ABI, functionName: "getAssertion", args: [assertion] });
    const created = BigInt(node.createdAtBlock);
    const block = await client.getBlock({ blockNumber: created });
    return { assertion, createdAtL1Block: created, ageSeconds: Math.max(0, Math.floor(Date.now() / 1000) - Number(block.timestamp)) };
  } catch {
    return { assertion: null, createdAtL1Block: null, ageSeconds: null };
  }
}

interface Governance {
  arbosVersion: number | null;
  owners: string[] | null;
}

async function governance(chainId: number): Promise<Governance> {
  const client = l2Client(chainId);
  const [version, owners] = await Promise.all([
    client.readContract({ address: ARB_SYS, abi: ARB_PRECOMPILE_ABI, functionName: "arbOSVersion" }).catch(function unavailable() {
      return null;
    }),
    client.readContract({ address: ARB_OWNER_PUBLIC, abi: ARB_PRECOMPILE_ABI, functionName: "getAllChainOwners" }).catch(function unavailable() {
      return null;
    }),
  ]);
  return {
    arbosVersion: version === null ? null : Number(version) - ARBOS_VERSION_OFFSET,
    owners: owners === null ? null : [...owners].map((owner) => owner.toLowerCase()).sort(),
  };
}

async function emitGovernanceChanges(chainId: number, before: { arbosVersion: number | null; chainOwners: unknown } | undefined, after: Governance, at: Date): Promise<void> {
  if (!before) {
    return;
  }
  const events = [];
  if (before.arbosVersion !== null && after.arbosVersion !== null && before.arbosVersion !== after.arbosVersion) {
    events.push({ chainId, kind: "chain.upgrade" as const, key: String(after.arbosVersion), detail: { from: before.arbosVersion, to: after.arbosVersion }, occurredAt: at });
  }
  const previousOwners = Array.isArray(before.chainOwners) ? (before.chainOwners as string[]).join(",") : null;
  if (previousOwners !== null && after.owners !== null && previousOwners !== after.owners.join(",")) {
    events.push({ chainId, kind: "chain.owners_changed" as const, key: after.owners.join(","), detail: { count: after.owners.length, owners: after.owners, previous: before.chainOwners }, occurredAt: at });
  }
  await emitEvents(events);
}

async function l1Facts(): Promise<{ batchCount: bigint | null; delayedMessages: bigint | null; posterBalance: bigint | null }> {
  const client = l1Client();
  const [batchCount, delayedMessages, posterBalance] = await Promise.all([
    client.readContract({ address: L1_SEQUENCER_INBOX, abi: SEQUENCER_INBOX_ABI, functionName: "batchCount" }).catch(function unavailable() {
      return null;
    }),
    client.readContract({ address: L1_BRIDGE, abi: BRIDGE_ABI, functionName: "delayedMessageCount" }).catch(function unavailable() {
      return null;
    }),
    client.getBalance({ address: L1_BATCH_POSTER }).catch(function unavailable() {
      return null;
    }),
  ]);
  return { batchCount, delayedMessages, posterBalance };
}

// The status page is the operator's own word; a change of it is an event even
// when every number we measure looks the same.
async function emitStatusChange(chainId: number, before: string | null, after: string | null, at: Date): Promise<void> {
  if (before === null || after === null || before === after) {
    return;
  }
  const kind = after === "OPERATIONAL" ? "chain.operational" : "chain.degraded";
  await emitEvents([{ chainId, kind, detail: { status: after, previous: before }, occurredAt: at }]);
}

export async function recordChainHealth(chainId: number): Promise<RunOutcome> {
  const head = await rawBlock(chainId, "latest");
  const headNumber = BigInt(head.number);
  const earlier = await rawBlock(chainId, `0x${(headNumber - BigInt(BLOCK_TIME_SAMPLE)).toString(16)}`);
  const blockTimeMs = Math.round(((Number(head.timestamp) - Number(earlier.timestamp)) * 1000) / BLOCK_TIME_SAMPLE);
  const [status, l1, final, gov] = await Promise.all([statusPage(), l1Facts(), finality(), governance(chainId)]);
  const checkedAt = new Date();
  const previous = await db
    .select({ statusPage: chainHealth.statusPage, arbosVersion: chainHealth.arbosVersion, chainOwners: chainHealth.chainOwners })
    .from(chainHealth)
    .where(eq(chainHealth.chainId, chainId))
    .orderBy(desc(chainHealth.checkedAt))
    .limit(1);
  await emitStatusChange(chainId, previous[0]?.statusPage ?? null, status, checkedAt);
  await emitGovernanceChanges(chainId, previous[0], gov, checkedAt);
  await db.insert(chainHealth).values({
    id: `${chainId}:${checkedAt.getTime()}`,
    chainId,
    checkedAt,
    headBlock: headNumber,
    blockTimeMs,
    baseFeeWei: head.baseFeePerGas ? BigInt(head.baseFeePerGas).toString() : null,
    l1Block: head.l1BlockNumber ? BigInt(head.l1BlockNumber) : null,
    batchCount: l1.batchCount,
    delayedMessages: l1.delayedMessages,
    batchPosterBalanceWei: l1.posterBalance === null ? null : l1.posterBalance.toString(),
    statusPage: status,
    detail: { headTimestamp: Number(head.timestamp) },
    arbosVersion: gov.arbosVersion,
    chainOwners: gov.owners,
    latestConfirmedAssertion: final.assertion,
    confirmedAtL1Block: final.createdAtL1Block,
    confirmedAgeSeconds: final.ageSeconds,
  });
  return { rows: 1, detail: { head: headNumber.toString(), blockTimeMs, status, arbos: gov.arbosVersion, confirmedAgeSeconds: final.ageSeconds } };
}
