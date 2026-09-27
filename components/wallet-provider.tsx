"use client";

import type { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { createAppKit } from "@reown/appkit/react";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { robinhood, robinhoodTestnet } from "viem/chains";
import { APP_URL, REOWN_PROJECT_ID } from "@/lib/config";

// Two wallet stacks, chosen once at module load by whether a Reown project id
// exists. With one, AppKit provides the modal, WalletConnect pairing and mobile
// wallets. Without one, plain wagmi with the browser's injected wallets: AppKit
// on a placeholder id calls Reown's API on every step, is refused each time, and
// on connect tries to switch the wallet to Robinhood Chain, which wallets that do
// not list the chain (Phantom) refuse with a "transaction error". Sign-in needs a
// signature, not a chain; the chain matters later, at payment and deploy time.

export const HAS_APPKIT = Boolean(REOWN_PROJECT_ID);

const CHAINS = [robinhoodTestnet, robinhood] as const;

function appKitConfig(): ReturnType<typeof createConfig> {
  const networks = [robinhoodTestnet, robinhood] as unknown as [AppKitNetwork, ...AppKitNetwork[]];
  const adapter = new WagmiAdapter({ projectId: REOWN_PROJECT_ID, networks, ssr: true });
  createAppKit({
    adapters: [adapter],
    projectId: REOWN_PROJECT_ID,
    networks,
    defaultNetwork: robinhoodTestnet as unknown as AppKitNetwork,
    // A wallet on another chain may still sign in; switching is asked for only
    // where a chain is needed, and refused switches must not break connect.
    enableNetworkSwitch: false,
    allowUnsupportedChain: true,
    metadata: {
      name: "Fletch",
      description: "Build on Robinhood Chain. Fletch keeps it running.",
      url: APP_URL,
      icons: [`${APP_URL}/icon.svg`],
    },
    features: { analytics: false, email: false, socials: [], onramp: false, swaps: false },
  });
  return adapter.wagmiConfig as ReturnType<typeof createConfig>;
}

function injectedConfig(): ReturnType<typeof createConfig> {
  return createConfig({
    chains: CHAINS,
    connectors: [injected()],
    // Every installed extension announces itself (EIP-6963), so a person with
    // two wallets can pick one instead of getting whichever grabbed window.ethereum.
    multiInjectedProviderDiscovery: true,
    ssr: true,
    transports: {
      [robinhoodTestnet.id]: http(),
      [robinhood.id]: http(),
    },
  });
}

const config = HAS_APPKIT ? appKitConfig() : injectedConfig();
const queryClient = new QueryClient();

interface WalletProviderProps {
  children: ReactNode;
}

export function WalletProvider({ children }: WalletProviderProps) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
