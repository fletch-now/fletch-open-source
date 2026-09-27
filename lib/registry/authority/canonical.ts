// Beacon dependency checks for officially listed Stock Tokens. The stored
// match and code hash are observations, not proof of who deployed a contract.

import { eq } from "drizzle-orm";
import type { Address } from "viem";
import { db } from "@/lib/db";
import { registryControlState } from "@/lib/db/schema";
import { codeHash, l2Client } from "@/lib/registry/authority/chain";
import { ACCESS_CONTROLS_REGISTRY, EIP1967_BEACON_SLOT } from "@/lib/registry/authority/constants";
import { activeAssets, patchState } from "@/lib/registry/authority/assets";
import type { RunOutcome } from "@/lib/registry/authority/runs";

function addressFromSlot(value: `0x${string}` | undefined): string | null {
  if (!value || value.length < 42) {
    return null;
  }
  const address = `0x${value.slice(-40)}`.toLowerCase();
  return address === "0x0000000000000000000000000000000000000000" ? null : address;
}

export async function checkCanonical(chainId: number): Promise<RunOutcome> {
  const client = l2Client(chainId);
  const assets = await activeAssets(chainId, "stock_token");
  const registry = ACCESS_CONTROLS_REGISTRY.toLowerCase();
  const stateRows = await db.select().from(registryControlState).where(eq(registryControlState.chainId, chainId)).limit(1);
  const implementation = stateRows[0]?.implementation ?? null;
  let canonicalCount = 0;
  for (const asset of assets) {
    const [slot, code] = await Promise.all([
      client.getStorageAt({ address: asset.address as Address, slot: EIP1967_BEACON_SLOT }),
      client.getCode({ address: asset.address as Address }),
    ]);
    const beacon = addressFromSlot(slot);
    const canonical = beacon === registry;
    if (canonical) {
      canonicalCount += 1;
    }
    await patchState(asset, {
      beaconAddress: beacon,
      implementationAddress: canonical ? implementation : null,
      codeHash: codeHash(code),
      canonical,
      canonicalCheckedAt: new Date(),
    });
  }
  return { rows: assets.length, detail: { canonical: canonicalCount, registry } };
}
