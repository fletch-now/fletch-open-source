import "server-only";
import { createPublicClient, erc20Abi, http, type Address } from "viem";
import { robinhood, robinhoodTestnet } from "@/lib/chains";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";
import type { TokenEvidence } from "./types";

export interface RecordedToken {
  id: string;
  address: string;
  chain_id: number;
  verified: boolean | null;
  verified_at: Date | null;
}

// Only platform-recorded project contracts reach this function. RPC URLs and
// contract ABIs never come from a listing form or an arbitrary remote address.
export async function validateToken(
  record: RecordedToken,
): Promise<TokenEvidence> {
  if (
    ![RH_MAINNET_ID, RH_TESTNET_ID].includes(record.chain_id) ||
    !/^0x[0-9a-fA-F]{40}$/.test(record.address)
  ) {
    throw new Error("Unsupported recorded token.");
  }
  const chain =
    record.chain_id === RH_MAINNET_ID ? robinhood : robinhoodTestnet;
  const client = createPublicClient({
    chain,
    transport: http(undefined, { timeout: 5000, retryCount: 0 }),
  });
  const address = record.address as Address;
  const [chainId, blockNumber] = await Promise.all([
    client.getChainId(),
    client.getBlockNumber(),
  ]);
  if (chainId !== record.chain_id)
    throw new Error("The RPC returned a different chain.");
  const [code, name, symbol, decimals, totalSupply] = await Promise.all([
    client.getCode({ address, blockNumber }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "name",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "symbol",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "decimals",
      blockNumber,
    }),
    client.readContract({
      address,
      abi: erc20Abi,
      functionName: "totalSupply",
      blockNumber,
    }),
  ]);
  if (
    !code ||
    code === "0x" ||
    !name.trim() ||
    name.length > 120 ||
    !symbol.trim() ||
    symbol.length > 32 ||
    /[<>\u0000-\u001F\u202A-\u202E\u2066-\u2069]/u.test(name + symbol)
  ) {
    throw new Error("The contract did not return usable token metadata.");
  }
  return {
    chainId,
    address: address.toLowerCase(),
    name,
    symbol,
    decimals,
    totalSupply: totalSupply.toString(),
    blockNumber: blockNumber.toString(),
    checkedAt: new Date().toISOString(),
    sourceVerified: record.verified === true,
    sourceVerifiedAt: record.verified_at?.toISOString() ?? null,
  };
}
