// Bridged crypto assets, proven rather than listed. For each candidate L1 token
// the L2 GatewayRouter names the one address the bridge would mint at; code at
// that address is the proof, and the contract's own symbol, name, decimals and
// supply are read from it. Candidates without code are reported and not stored,
// so the registry can never carry a "WBTC" nobody bridged.

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryAssets } from "@/lib/db/schema";
import { ERC20_META_ABI, GATEWAY_ROUTER_ABI } from "@/lib/registry/authority/abis";
import { l2Client, multicall, type MulticallResult } from "@/lib/registry/authority/chain";
import { BRIDGE_CANDIDATES, L2_GATEWAY_ROUTER, type BridgeCandidate } from "@/lib/registry/authority/constants";
import type { RunOutcome } from "@/lib/registry/authority/runs";
import { emitEvents } from "@/lib/registry/authority/events";

const READS = ["symbol", "name", "decimals", "totalSupply"] as const;

interface BridgedToken {
  candidate: BridgeCandidate;
  address: `0x${string}`;
  symbol: string;
  name: string;
  decimals: number;
  totalSupply: bigint;
}

function stringOf(result: MulticallResult): string | null {
  return result.status === "success" && typeof result.result === "string" ? result.result : null;
}

function numberOf(result: MulticallResult): number | null {
  return result.status === "success" && typeof result.result === "number" ? result.result : null;
}

function bigintOf(result: MulticallResult): bigint | null {
  return result.status === "success" && typeof result.result === "bigint" ? result.result : null;
}

function readToken(candidate: BridgeCandidate, address: `0x${string}`, results: MulticallResult[]): BridgedToken | null {
  const [symbol, name, decimals, totalSupply] = results;
  const symbolValue = stringOf(symbol);
  const nameValue = stringOf(name);
  const decimalsValue = numberOf(decimals);
  const supplyValue = bigintOf(totalSupply);
  if (symbolValue === null || nameValue === null || decimalsValue === null || supplyValue === null) {
    return null;
  }
  return { candidate, address, symbol: symbolValue, name: nameValue, decimals: decimalsValue, totalSupply: supplyValue };
}

async function upsertBridged(chainId: number, token: BridgedToken): Promise<boolean> {
  const address = token.address.toLowerCase();
  const now = new Date();
  const inserted = await db
    .insert(registryAssets)
    .values({
      id: `${chainId}:${address}`,
      chainId,
      address,
      symbol: token.symbol,
      name: token.name,
      assetType: "bridged",
      decimals: token.decimals,
      status: "active",
      source: "arbitrum-gateway",
      sourceUri: token.candidate.l1Address,
      observedAt: now,
      verifiedAt: now,
      onchainName: token.name,
      onchainSymbol: token.symbol,
      onchainDecimals: token.decimals,
      metadataCheckedAt: now,
      raw: { l1Address: token.candidate.l1Address, router: L2_GATEWAY_ROUTER, totalSupplyRaw: token.totalSupply.toString() },
    })
    .onConflictDoUpdate({
      target: registryAssets.id,
      set: {
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        observedAt: now,
        verifiedAt: now,
        onchainName: token.name,
        onchainSymbol: token.symbol,
        onchainDecimals: token.decimals,
        metadataCheckedAt: now,
        raw: { l1Address: token.candidate.l1Address, router: L2_GATEWAY_ROUTER, totalSupplyRaw: token.totalSupply.toString() },
      },
    })
    // xmax = 0 is Postgres's own word for "this row was inserted, not updated".
    .returning({ inserted: sql<boolean>`(xmax = 0)` });
  return inserted[0]?.inserted === true;
}

export async function syncBridgedAssets(chainId: number): Promise<RunOutcome> {
  const client = l2Client(chainId);
  const computed = await multicall(
    client,
    BRIDGE_CANDIDATES.map(function call(candidate) {
      return { address: L2_GATEWAY_ROUTER, abi: GATEWAY_ROUTER_ABI, functionName: "calculateL2TokenAddress", args: [candidate.l1Address] };
    }),
  );
  const located: Array<{ candidate: BridgeCandidate; address: `0x${string}` }> = [];
  for (const [index, candidate] of BRIDGE_CANDIDATES.entries()) {
    const result = computed[index];
    if (result.status === "success" && typeof result.result === "string") {
      located.push({ candidate, address: result.result as `0x${string}` });
    }
  }
  // The router answers a pure computation; every call failing means the RPC
  // refused the batch, and that is a failed run, not "nothing bridged".
  if (located.length === 0) {
    throw new Error("gateway router answered no candidate (RPC refused the batch)");
  }

  const codes = await Promise.all(
    located.map(function code(entry) {
      return client.getCode({ address: entry.address });
    }),
  );
  const deployed = located.filter(function hasCode(_entry, index) {
    const code = codes[index];
    return code !== undefined && code !== "0x";
  });
  const neverBridged = located.length - deployed.length;

  const reads = await multicall(
    client,
    deployed.flatMap(function forToken(entry) {
      return READS.map(function read(functionName) {
        return { address: entry.address, abi: ERC20_META_ABI, functionName };
      });
    }),
  );
  let stored = 0;
  const newListings: string[] = [];
  for (const [index, entry] of deployed.entries()) {
    const token = readToken(entry.candidate, entry.address, reads.slice(index * READS.length, (index + 1) * READS.length));
    if (!token) {
      continue;
    }
    const isNew = await upsertBridged(chainId, token);
    stored += 1;
    if (isNew) {
      newListings.push(token.symbol);
      await emitEvents([
        {
          chainId,
          kind: "listing.new",
          assetId: `${chainId}:${token.address.toLowerCase()}`,
          address: token.address.toLowerCase(),
          symbol: token.symbol,
          detail: { assetType: "bridged", name: token.name, l1Address: token.candidate.l1Address },
          occurredAt: new Date(),
        },
      ]);
    }
  }
  return { rows: stored, detail: { candidates: BRIDGE_CANDIDATES.length, neverBridged, newListings } };
}
