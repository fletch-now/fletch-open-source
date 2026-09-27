// Which assets a history scanner has read from genesis. A scanner that filters
// on a list of addresses only sees an asset from the block it was added at;
// an asset listed after the checkpoint exists needs its own pass over the
// blocks before that. The marker is a sync_checkpoints row per asset, written
// once the asset's history has been read up to the scanner's checkpoint.

import { like } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncCheckpoints } from "@/lib/db/schema";
import type { TrackedAsset } from "@/lib/registry/authority/assets";
import { writeCheckpoint } from "@/lib/registry/authority/runs";

function markerName(scanner: string, assetId: string): string {
  return `${scanner}-asset:${assetId}`;
}

export async function uncoveredAssets(scanner: string, assets: TrackedAsset[]): Promise<TrackedAsset[]> {
  const rows = await db.select({ name: syncCheckpoints.name }).from(syncCheckpoints).where(like(syncCheckpoints.name, `${scanner}-asset:%`));
  const covered = new Set(rows.map((row) => row.name));
  return assets.filter((asset) => !covered.has(markerName(scanner, asset.id)));
}

export async function markCovered(scanner: string, chainId: number, assets: TrackedAsset[], toBlock: bigint): Promise<void> {
  for (const asset of assets) {
    await writeCheckpoint(markerName(scanner, asset.id), chainId, { blockNumber: toBlock, blockHash: "" });
  }
}
