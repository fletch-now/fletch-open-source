// GET /api/v1/chains — the two Robinhood chains Fletch knows about, with a public
// RPC endpoint, the explorer, and whether a provider key is configured for that
// chain. Never returns `getRpcUrl`'s resolved value: a configured provider URL
// (Alchemy, QuickNode) can carry an embedded API key, so this always publishes the
// public fallback address and reports the key as a boolean instead. Public, like
// every other registry read: nothing in the body is private.

import { robinhood, robinhoodTestnet } from "viem/chains";
import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied } from "@/lib/api/etag";
import { PUBLIC_RPC_URLS, usingPublicRpc } from "@/lib/chain/rpc";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";

export { preflight as OPTIONS } from "@/lib/api/etag";

// The list changes with a deploy, not with any job.
const MAX_AGE_SECONDS = 3_600;

interface ChainInfo {
  chainId: number;
  name: string;
  network: "mainnet" | "testnet";
  rpcUrl: string;
  explorerUrl: string;
  providerConfigured: boolean;
}

function chainInfo(chainId: number, network: "mainnet" | "testnet"): ChainInfo {
  const chain = chainId === RH_MAINNET_ID ? robinhood : robinhoodTestnet;
  return {
    chainId,
    name: chain.name,
    network,
    rpcUrl: PUBLIC_RPC_URLS[chainId] ?? "",
    explorerUrl: chain.blockExplorers?.default.url ?? "",
    providerConfigured: !usingPublicRpc(chainId),
  };
}

export async function GET(request: Request): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  return cachedJson(request, { chains: [chainInfo(RH_MAINNET_ID, "mainnet"), chainInfo(RH_TESTNET_ID, "testnet")] }, MAX_AGE_SECONDS);
}
