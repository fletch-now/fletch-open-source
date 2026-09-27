// Once a day, from the holder ledger: how many addresses hold each asset, how
// much of it sits with the largest of them, and where the supply actually is —
// in a DEX pool, in the issuer's wallets, in a bridge gateway, in some other
// contract, or in ordinary wallets, which is the float. Skipped while the
// ledger is still reading history, because a concentration figure over half
// the transfers is not a figure.

import { db } from "@/lib/db";
import { assetConcentration } from "@/lib/db/schema";
import { activeAssets, type TrackedAsset } from "@/lib/registry/authority/assets";
import { bucketOf, FLOAT_BUCKETS, labelledBalances, topMintRecipients, type FloatBucket } from "@/lib/registry/authority/labels";
import { ledgerProgress } from "@/lib/registry/authority/ledger";
import type { RunOutcome } from "@/lib/registry/authority/runs";

const MAX_LAG = BigInt(10_000);

export type FloatShares = Record<FloatBucket, number | null>;

interface Reading {
  holders: number;
  top1Pct: number | null;
  top10Pct: number | null;
  gini: number | null;
  issuerAddress: string | null;
  shares: FloatShares;
}

function pct(part: bigint, whole: bigint): number | null {
  return whole === BigInt(0) ? null : Number((part * BigInt(1_000_000)) / whole) / 10_000;
}

// Gini over balances sorted ascending: 1 - 2 * (sum of cumulative shares) / n,
// computed in floating point on shares, which is fine at this precision.
function gini(balances: bigint[]): number | null {
  if (balances.length < 2) {
    return null;
  }
  const total = balances.reduce((sum, value) => sum + value, BigInt(0));
  if (total === BigInt(0)) {
    return null;
  }
  const ascending = [...balances].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  let weighted = 0;
  ascending.forEach(function accumulate(value, index) {
    weighted += (index + 1) * (Number((value * BigInt(1_000_000_000)) / total) / 1_000_000_000);
  });
  const n = ascending.length;
  return Number(((2 * weighted) / n - (n + 1) / n).toFixed(4));
}

async function readOne(asset: TrackedAsset, issuerAddress: string | null): Promise<Reading> {
  const rows = await labelledBalances(asset.id);
  const balances = rows.map((row) => BigInt(row.rawBalance.split(".")[0]));
  const total = balances.reduce((sum, value) => sum + value, BigInt(0));
  const top10 = balances.slice(0, 10).reduce((sum, value) => sum + value, BigInt(0));
  const held = new Map<FloatBucket, bigint>();
  rows.forEach(function accumulate(row, index) {
    const bucket = bucketOf(row.kind);
    held.set(bucket, (held.get(bucket) ?? BigInt(0)) + balances[index]);
  });
  const shares = Object.fromEntries(FLOAT_BUCKETS.map((bucket) => [bucket, pct(held.get(bucket) ?? BigInt(0), total)])) as FloatShares;
  return {
    holders: rows.length,
    top1Pct: balances[0] === undefined ? null : pct(balances[0], total),
    top10Pct: pct(top10, total),
    gini: gini(balances),
    issuerAddress,
    shares,
  };
}

export async function snapshotConcentration(chainId: number): Promise<RunOutcome> {
  const progress = await ledgerProgress(chainId);
  if (progress.behind === null || progress.behind > MAX_LAG) {
    return { rows: 0, detail: { skipped: "transfer ledger is still behind head", behind: progress.behind?.toString() ?? null } };
  }
  const assets = (await activeAssets(chainId)).filter((asset) => asset.assetType !== "wrapped_native");
  // The address each asset's mints go to most often, read for every asset in
  // one query rather than once per asset inside the loop.
  const mintRecipients = new Map((await topMintRecipients(chainId)).map((row) => [row.assetId, row.counterparty]));
  const day = new Date().toISOString().slice(0, 10);
  let written = 0;
  let unknown = 0;
  for (const asset of assets) {
    const reading = await readOne(asset, mintRecipients.get(asset.id) ?? null);
    // issuerPct is the share of every wallet labelled `issuer`, which the
    // labels job writes only for Stock Tokens, whose mints are the issuer
    // creating inventory. issuerAddress stays this asset's own largest mint
    // recipient whatever the asset is, so for USDG and the bridged tokens it
    // names the largest depositor and no issuer share is subtracted from float.
    const values = {
      holders: reading.holders,
      top1Pct: reading.top1Pct?.toString() ?? null,
      top10Pct: reading.top10Pct?.toString() ?? null,
      gini: reading.gini?.toString() ?? null,
      issuerPct: reading.shares.issuer?.toString() ?? null,
      issuerAddress: reading.issuerAddress,
      poolsPct: reading.shares.pools?.toString() ?? null,
      bridgePct: reading.shares.bridge?.toString() ?? null,
      contractsPct: reading.shares.contracts?.toString() ?? null,
      unknownPct: reading.shares.unknown?.toString() ?? null,
      floatPct: reading.shares.float?.toString() ?? null,
      headBlock: progress.block ?? BigInt(0),
    };
    await db
      .insert(assetConcentration)
      .values({ id: `${asset.id}:${day}`, assetId: asset.id, day, ...values })
      .onConflictDoUpdate({ target: assetConcentration.id, set: { ...values, takenAt: new Date() } });
    written += 1;
    if ((reading.shares.unknown ?? 0) > 0) {
      unknown += 1;
    }
  }
  return { rows: written, detail: { day, assetsWithUnknownHolders: unknown } };
}
