// Chainlink round history. The feeds job records every round it sees at the
// head; this module also walks each feed backwards through getRoundData
// until it holds a window of history, so the price a feed reported at any
// moment can be read here rather than reconstructed from an archive node.

import { desc, eq, min, sql } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { feedRounds, registryAssetState, registryAssets } from "@/lib/db/schema";
import { AGGREGATOR_ABI } from "@/lib/registry/authority/abis";
import { l2Client, multicall } from "@/lib/registry/authority/chain";
import { feedDirectory, scaled } from "@/lib/registry/authority/feeds";
import type { RunOutcome } from "@/lib/registry/authority/runs";

export interface RoundReading {
  roundId: bigint;
  answer: bigint;
  startedAt: bigint;
  updatedAt: bigint;
}

interface RoundTarget {
  id: string;
  symbol: string;
}

// How far back each feed is filled. Equity feeds post on 0.5% moves during
// market hours and once a day otherwise, so this is weeks of history.
const TARGET_ROUNDS = 2_000;
// Rounds requested per multicall while walking backwards.
const STEP = 100;

// Feeds the backfill has hit the bottom of (phase boundary or round 1) in
// this process; asking again would only repeat the same refused reads.
const exhausted = new Set<string>();

function roundRow(chainId: number, feedAddress: string, target: RoundTarget | null, decimals: number, reading: RoundReading) {
  return {
    id: `${feedAddress.toLowerCase()}:${reading.roundId.toString()}`,
    chainId,
    feedAddress: feedAddress.toLowerCase(),
    assetId: target?.id ?? null,
    symbol: target?.symbol ?? null,
    roundId: reading.roundId.toString(),
    answer: scaled(reading.answer, decimals),
    startedAt: reading.startedAt > BigInt(0) ? new Date(Number(reading.startedAt) * 1000) : null,
    updatedAt: new Date(Number(reading.updatedAt) * 1000),
  };
}

export async function recordRounds(chainId: number, feedAddress: string, target: RoundTarget | null, decimals: number, readings: RoundReading[]): Promise<number> {
  const rows = readings.filter((reading) => reading.updatedAt > BigInt(0)).map((reading) => roundRow(chainId, feedAddress, target, decimals, reading));
  if (rows.length === 0) {
    return 0;
  }
  const inserted = await db.insert(feedRounds).values(rows).onConflictDoNothing().returning({ id: feedRounds.id });
  return inserted.length;
}

async function coverage(feedAddress: string): Promise<{ count: number; lowest: bigint | null }> {
  const rows = await db
    .select({ count: sql<number>`count(*)`, lowest: min(feedRounds.roundId) })
    .from(feedRounds)
    .where(eq(feedRounds.feedAddress, feedAddress.toLowerCase()));
  const row = rows[0];
  return { count: Number(row?.count ?? 0), lowest: row?.lowest ? BigInt(row.lowest) : null };
}

async function targetFor(feedAddress: string): Promise<RoundTarget | null> {
  const rows = await db
    .select({ id: registryAssetState.assetId, symbol: registryAssets.symbol })
    .from(registryAssetState)
    .innerJoin(registryAssets, eq(registryAssets.id, registryAssetState.assetId))
    .where(eq(registryAssetState.feedAddress, feedAddress.toLowerCase()))
    .limit(1);
  return rows[0] ?? null;
}

// Walks one feed back one STEP. Returns how many rounds were new; marks the
// feed exhausted when the chain refuses a round, which is what a phase
// boundary or round zero looks like from outside.
async function fillOne(chainId: number, feedAddress: Address, decimals: number): Promise<number> {
  const { count, lowest } = await coverage(feedAddress);
  if (count >= TARGET_ROUNDS || lowest === null || lowest <= BigInt(1)) {
    return 0;
  }
  const target = await targetFor(feedAddress);
  const roundIds: bigint[] = [];
  for (let id = lowest - BigInt(1); id > lowest - BigInt(STEP) - BigInt(1) && id > BigInt(0); id -= BigInt(1)) {
    roundIds.push(id);
  }
  const results = await multicall(
    l2Client(chainId),
    roundIds.map(function call(roundId) {
      return { address: feedAddress, abi: AGGREGATOR_ABI, functionName: "getRoundData", args: [roundId] };
    }),
  );
  const readings: RoundReading[] = [];
  let refused = false;
  for (const [index, result] of results.entries()) {
    if (result.status !== "success" || !Array.isArray(result.result)) {
      refused = true;
      continue;
    }
    const [roundId, answer, startedAt, updatedAt] = result.result as [bigint, bigint, bigint, bigint, bigint];
    readings.push({ roundId: roundId === BigInt(0) ? roundIds[index] : roundId, answer, startedAt, updatedAt });
  }
  if (refused) {
    exhausted.add(feedAddress.toLowerCase());
  }
  return recordRounds(chainId, feedAddress, target, decimals, readings);
}

export async function backfillFeedRounds(chainId: number): Promise<RunOutcome> {
  const feeds = await feedDirectory();
  const attached = await db.select({ feedAddress: registryAssetState.feedAddress }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
  const wanted = new Set(attached.map((row) => row.feedAddress).filter((address): address is string => address !== null));
  let inserted = 0;
  let filled = 0;
  for (const feed of feeds) {
    const address = feed.address.toLowerCase();
    if (!wanted.has(address) || exhausted.has(address)) {
      continue;
    }
    const added = await fillOne(chainId, feed.address, feed.decimals);
    inserted += added;
    if (added > 0) {
      filled += 1;
    }
  }
  return { rows: inserted, detail: { feeds: wanted.size, filled, exhausted: exhausted.size } };
}

export async function latestRoundFor(feedAddress: string) {
  const rows = await db.select().from(feedRounds).where(eq(feedRounds.feedAddress, feedAddress.toLowerCase())).orderBy(desc(feedRounds.roundId)).limit(1);
  return rows[0] ?? null;
}
