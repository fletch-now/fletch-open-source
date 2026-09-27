// Explorer links, built from viem's own chain definitions rather than a guessed
// host — both robinhood and robinhoodTestnet carry blockExplorers.default, so the
// fallback below only guards against a future chain definition that drops it.

import { robinhood, robinhoodTestnet } from "viem/chains";
import { RH_MAINNET_ID } from "@/lib/config";

const FALLBACK_EXPLORER_URL = "https://explorer.robinhood.com";

export function explorerBaseUrl(chainId: number): string {
  const chain = chainId === RH_MAINNET_ID ? robinhood : robinhoodTestnet;
  return chain.blockExplorers?.default.url ?? FALLBACK_EXPLORER_URL;
}

export function explorerTxUrl(chainId: number, txHash: string): string {
  return `${explorerBaseUrl(chainId)}/tx/${txHash}`;
}

export function explorerAddressUrl(chainId: number, address: string): string {
  return `${explorerBaseUrl(chainId)}/address/${address}`;
}
