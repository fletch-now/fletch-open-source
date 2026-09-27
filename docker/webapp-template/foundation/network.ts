import { createPublicClient, http } from 'viem';
import { robinhood, robinhoodTestnet } from 'viem/chains';

const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? robinhoodTestnet.id);
if (chainId !== robinhood.id && chainId !== robinhoodTestnet.id) {
  throw new Error('This app requires a configured Robinhood Chain network.');
}
export const appChain = chainId === robinhood.id ? robinhood : robinhoodTestnet;
export const rpcUrl = import.meta.env.VITE_RPC_URL || appChain.rpcUrls.default.http[0];
export const publicClient = createPublicClient({ chain: appChain, transport: http(rpcUrl) });
