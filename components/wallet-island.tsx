"use client";

import { WalletProvider } from "@/components/wallet-provider";
import { ConnectWallet } from "@/components/connect-wallet";

// wagmi + viem + AppKit are ~1.5 MB of JavaScript and the only thing on the landing
// page that needs them is this one button. Keeping the provider in the root layout
// made every visitor download the whole wallet stack before first paint, including
// the ones who never connect. It lives behind a dynamic import instead.

export function WalletIsland({ tone }: { tone?: "light" | "night" }) {
  return (
    <WalletProvider>
      <ConnectWallet tone={tone} />
    </WalletProvider>
  );
}
