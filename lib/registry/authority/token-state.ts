// What every Stock Token answers about itself right now: multiplier, the
// pending multiplier and when it takes effect, pause flags, raw and UI supply.
// Seven reads per token, batched through Multicall3.

import { formatUnits } from "viem";
import { STOCK_ABI } from "@/lib/registry/authority/abis";
import { l2Client, multicall, type MulticallResult } from "@/lib/registry/authority/chain";
import { activeAssets, patchState, type TrackedAsset } from "@/lib/registry/authority/assets";
import type { RunOutcome } from "@/lib/registry/authority/runs";

const READS = ["uiMultiplier", "newUIMultiplier", "effectiveAt", "tokenPaused", "oraclePaused", "totalSupply", "totalSupplyUI"] as const;

function bigintOf(result: MulticallResult): bigint | null {
  return result.status === "success" && typeof result.result === "bigint" ? result.result : null;
}

function boolOf(result: MulticallResult): boolean | null {
  return result.status === "success" && typeof result.result === "boolean" ? result.result : null;
}

// A zero effectiveAt means no multiplier change is scheduled.
function effectiveDate(seconds: bigint | null): Date | null {
  return seconds && seconds > BigInt(0) ? new Date(Number(seconds) * 1000) : null;
}

async function applyReads(asset: TrackedAsset, results: MulticallResult[]): Promise<boolean> {
  const [multiplier, next, effectiveAt, tokenPaused, oraclePaused, supply, supplyUi] = results;
  const failures = results.filter(function failed(result) {
    return result.status !== "success";
  }).length;
  // USDG and WETH are not Stock contracts: every read fails, and that is the
  // answer, not an error.
  if (failures === results.length) {
    await patchState(asset, { stateCheckedAt: new Date(), stateError: "not a Stock contract" });
    return false;
  }
  const rawMultiplier = bigintOf(multiplier);
  const rawNext = bigintOf(next);
  const rawSupply = bigintOf(supply);
  const rawSupplyUi = bigintOf(supplyUi);
  await patchState(asset, {
    uiMultiplier: rawMultiplier === null ? null : formatUnits(rawMultiplier, 18),
    newUiMultiplier: rawNext === null ? null : formatUnits(rawNext, 18),
    multiplierEffectiveAt: effectiveDate(bigintOf(effectiveAt)),
    tokenPaused: boolOf(tokenPaused),
    oraclePaused: boolOf(oraclePaused),
    totalSupplyRaw: rawSupply === null ? null : rawSupply.toString(),
    totalSupplyUi: rawSupplyUi === null ? null : rawSupplyUi.toString(),
    stateCheckedAt: new Date(),
    stateError: failures > 0 ? `${failures} of ${results.length} reads failed` : null,
  });
  return true;
}

export async function refreshTokenState(chainId: number): Promise<RunOutcome> {
  const assets = await activeAssets(chainId);
  const client = l2Client(chainId);
  const calls = assets.flatMap(function forAsset(asset) {
    return READS.map(function read(functionName) {
      return { address: asset.address, abi: STOCK_ABI, functionName };
    });
  });
  const results = await multicall(client, calls);
  let updated = 0;
  for (const [index, asset] of assets.entries()) {
    const slice = results.slice(index * READS.length, (index + 1) * READS.length);
    if (await applyReads(asset, slice)) {
      updated += 1;
    }
  }
  return { rows: updated, detail: { assets: assets.length } };
}
