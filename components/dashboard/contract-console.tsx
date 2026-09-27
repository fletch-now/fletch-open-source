"use client";

import dynamic from "next/dynamic";
import type { Abi } from "viem";
import { WalletBoundary } from "@/components/wallet-boundary";

// The contract console needs wagmi, which stays behind a dynamic import so a
// project page without a deploy never loads the wallet stack.

interface ContractConsoleProps {
  address: `0x${string}`;
  chainId: number;
  abi: Abi;
  explorerUrl: string;
}

function Placeholder() {
  return <div className="h-40 w-full animate-pulse rounded-lg bg-panel" aria-hidden="true" />;
}

const Island = dynamic(
  function load() {
    return Promise.all([import("@/components/wallet-provider"), import("@/components/dashboard/contract-console-island")]).then(
      function pick([provider, island]) {
        function Mounted(props: ContractConsoleProps) {
          return (
            <provider.WalletProvider>
              <island.ContractConsoleIsland {...props} />
            </provider.WalletProvider>
          );
        }
        return Mounted;
      },
    );
  },
  { ssr: false, loading: Placeholder },
);

export function ContractConsole(props: ContractConsoleProps) {
  return (
    <WalletBoundary>
      <Island {...props} />
    </WalletBoundary>
  );
}
