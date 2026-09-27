"use client";

import dynamic from "next/dynamic";
import type { Abi, Hex } from "viem";

// The mainnet deploy button needs wagmi, which stays behind a dynamic import
// like the contract console: a project page without a deploy never loads it.

interface MainnetDeployProps {
  buildId: string;
  abi: Abi;
  bytecode: Hex;
  contractName: string;
  takesOwner: boolean;
}

function Placeholder() {
  return <div className="h-11 w-64 animate-pulse rounded-full bg-panel" aria-hidden="true" />;
}

const Island = dynamic(
  function load() {
    return Promise.all([import("@/components/wallet-provider"), import("@/components/dashboard/mainnet-deploy-island")]).then(function pick([provider, island]) {
      function Mounted(props: MainnetDeployProps) {
        return (
          <provider.WalletProvider>
            <island.MainnetDeployIsland {...props} />
          </provider.WalletProvider>
        );
      }
      return Mounted;
    });
  },
  { ssr: false, loading: Placeholder },
);

export function MainnetDeploy(props: MainnetDeployProps) {
  return <Island {...props} />;
}
