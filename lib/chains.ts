import { createPublicClient, http, type PublicClient } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { RH_MAINNET_ID } from "@/lib/config";

export { robinhood, robinhoodTestnet };

// One public client per network, used for SIWE signature verification
// (viem's verifyMessage resolves EOA, ERC-1271, and ERC-6492 signatures).
export function getPublicClient(chainId: number): PublicClient {
  const chain = chainId === RH_MAINNET_ID ? robinhood : robinhoodTestnet;
  return createPublicClient({ chain, transport: http() });
}
