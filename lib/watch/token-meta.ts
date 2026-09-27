import { erc20Abi } from "viem";
import { getChainClient } from "@/lib/chain/rpc";

export interface TokenMeta {
  name: string;
  symbol: string;
  decimals: number;
}

export interface TokenProbe {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  bytecodePresent: boolean | null;
  blockNumber: bigint | null;
}

// Metadata can change on an upgradeable contract. Bound both age and memory.
const cache = new Map<string, { probe: TokenProbe; expiresAt: number }>();

export async function readTokenProbe(chainId: number, address: string): Promise<TokenProbe> {
  const key = `${chainId}:${address.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.probe;
  }
  const client = getChainClient(chainId);
  const contract = { abi: erc20Abi, address: address as `0x${string}` } as const;
  const [code, name, symbol, decimals, block] = await Promise.allSettled([
    client.getBytecode({ address: contract.address }),
    client.readContract({ ...contract, functionName: "name" }),
    client.readContract({ ...contract, functionName: "symbol" }),
    client.readContract({ ...contract, functionName: "decimals" }),
    client.getBlockNumber(),
  ]);
  const probe: TokenProbe = {
    bytecodePresent: code.status === "fulfilled" ? Boolean(code.value && code.value !== "0x") : null,
    name: name.status === "fulfilled" ? name.value : null,
    symbol: symbol.status === "fulfilled" ? symbol.value : null,
    decimals: decimals.status === "fulfilled" ? decimals.value : null,
    blockNumber: block.status === "fulfilled" ? block.value : null,
  };
  if (cache.size >= 1_000) {
    cache.delete(cache.keys().next().value as string);
  }
  const resolved = probe.bytecodePresent === true && probe.decimals !== null;
  cache.set(key, { probe, expiresAt: Date.now() + (resolved ? 300_000 : 15_000) });
  return probe;
}

export async function readTokenMeta(chainId: number, address: string): Promise<TokenMeta | null> {
  const probe = await readTokenProbe(chainId, address);
  if (probe.bytecodePresent !== true || probe.decimals === null) {
    return null;
  }
  return { name: probe.name ?? address, symbol: probe.symbol ?? address, decimals: probe.decimals };
}
