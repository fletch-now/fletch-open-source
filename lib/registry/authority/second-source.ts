// Compare contract supply with Blockscout's independent indexer counts.
// Its holder and transfer counts remain separate from Fletch's own transfer
// ledger, whose historical coverage may still be incomplete.

import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryAssetState } from "@/lib/db/schema";
import { activeAssets, patchState, type TrackedAsset } from "@/lib/registry/authority/assets";
import { BlockscoutEndpointError, BlockscoutUnavailableError, tokenCounters, tokenInfo } from "@/lib/registry/authority/blockscout";
import { JOB_CADENCES } from "./cadence";
import { logEvent } from "@/lib/log";
import type { RunOutcome } from "@/lib/registry/authority/runs";

export type SupplyAgreement = "agree" | "close" | "differ" | "unknown";

// Both sources are read minutes apart and Stock Tokens mint all day, so a
// small gap is timing, not disagreement. One part in a thousand is the line.
const CLOSE_TOLERANCE = 0.001;

function agreement(ours: string | null, theirs: string | null): SupplyAgreement {
  if (ours === null || theirs === null) {
    return "unknown";
  }
  if (ours === theirs) {
    return "agree";
  }
  const a = Number(ours);
  const b = Number(theirs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.max(a, b) === 0) {
    return "differ";
  }
  return Math.abs(a - b) / Math.max(a, b) <= CLOSE_TOLERANCE ? "close" : "differ";
}

async function checkOne(asset: TrackedAsset): Promise<SupplyAgreement> {
  const [info, counters] = await Promise.all([tokenInfo(asset.address), tokenCounters(asset.address)]);
  const current = await db
    .select({ totalSupplyRaw: registryAssetState.totalSupplyRaw })
    .from(registryAssetState)
    .where(eq(registryAssetState.assetId, asset.id))
    .limit(1);
  const verdict = agreement(current[0]?.totalSupplyRaw ?? null, info?.totalSupplyRaw ?? null);
  await patchState(asset, {
    blockscoutHolders: counters?.holders ?? info?.holders ?? null,
    blockscoutTransfers: counters?.transfers === null || counters?.transfers === undefined ? null : BigInt(counters.transfers),
    blockscoutTotalSupplyRaw: info?.totalSupplyRaw ?? null,
    blockscoutCheckedAt: new Date(),
    supplyAgreement: verdict,
  });
  return verdict;
}

type Observations = Map<string, Date | null>;

async function checkedAssets(assets: TrackedAsset[]): Promise<Observations> {
  if (assets.length === 0) return new Map();
  const rows = await db.select({ id: registryAssetState.assetId, at: registryAssetState.blockscoutCheckedAt })
    .from(registryAssetState).where(inArray(registryAssetState.assetId, assets.map((asset) => asset.id)));
  return new Map(rows.map((row) => [row.id, row.at]));
}

function due(at: Date | null | undefined, now: Date): boolean {
  if (!at) return true;
  const age = now.getTime() - at.getTime();
  return !Number.isFinite(age) || age < 0 || age >= JOB_CADENCES["second-source"];
}

export async function refreshSecondSource(
  chainId: number,
  readAsset: (asset: TrackedAsset) => Promise<SupplyAgreement> = checkOne,
  loadAssets: typeof activeAssets = activeAssets,
  readObservations: (assets: TrackedAsset[]) => Promise<Observations> = checkedAssets,
  clock: () => Date = () => new Date(),
): Promise<RunOutcome> {
  const assets = await loadAssets(chainId);
  const observations = await readObservations(assets);
  const startedAt = clock();
  const pending = assets.filter((asset) => due(observations.get(asset.id), startedAt));
  pending.sort((a, b) => (observations.get(a.id)?.getTime() ?? 0) - (observations.get(b.id)?.getTime() ?? 0));
  const tally: Record<SupplyAgreement, number> = { agree: 0, close: 0, differ: 0, unknown: 0 };
  const failedAssetIds: string[] = [];
  for (const asset of pending) {
    try {
      tally[await readAsset(asset)] += 1;
    } catch (error) {
      if (error instanceof BlockscoutUnavailableError) throw error;
      failedAssetIds.push(asset.id);
      logEvent("registry", { event: "second-source-asset-failed", assetId: asset.id, errorName: error instanceof Error ? error.name : "unknown", status: error instanceof BlockscoutEndpointError ? error.status : null, path: error instanceof BlockscoutEndpointError ? error.path : null });
    }
  }
  const finished = await readObservations(assets);
  const checkedAt = clock();
  const remaining = assets.filter((asset) => due(finished.get(asset.id), checkedAt));
  const detail = { ...tally, failed: failedAssetIds.length, failedAssetIds, due: pending.length, remaining: remaining.length, skippedFresh: assets.length - pending.length };
  if (remaining.length > 0 || failedAssetIds.length > 0) {
    logEvent("registry", { event: "second-source-incomplete", ...detail });
    throw new Error(`Blockscout incomplete: ${remaining.length}/${assets.length} observations still due; ${failedAssetIds.length} failed assets: ${failedAssetIds.slice(0, 4).join(", ")}`);
  }
  return { rows: pending.length, detail };
}
