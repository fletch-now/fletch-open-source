"use client";

import dynamic from "next/dynamic";
import { WalletBoundary } from "@/components/wallet-boundary";

// The pay flow needs wagmi, which lives behind a dynamic import so pages that
// never pay do not load the wallet stack. The dashboard page has no provider
// above it, so the island brings its own, the same way the wallet button does.

interface PayButtonProps {
  treasury: string | null;
  priceUsdg: number;
}

function Placeholder() {
  return <div className="h-11 w-full max-w-md animate-pulse rounded-lg bg-panel" aria-hidden="true" />;
}

const Island = dynamic(
  function load() {
    return Promise.all([import("@/components/wallet-provider"), import("@/components/pay-island")]).then(function pick([provider, island]) {
      function Mounted(props: { treasury: string; priceUsdg: number }) {
        return (
          <provider.WalletProvider>
            <island.PayIsland {...props} />
          </provider.WalletProvider>
        );
      }
      return Mounted;
    });
  },
  { ssr: false, loading: Placeholder },
);

export function PayButton({ treasury, priceUsdg }: PayButtonProps) {
  if (!treasury) {
    return (
      <p className="text-[13.5px] text-ink-soft">
        Credit purchases are not open on this deployment yet. When they are, you pay in USDG from the wallet you signed in
        with.
      </p>
    );
  }
  return (
    <WalletBoundary>
      <Island treasury={treasury} priceUsdg={priceUsdg} />
    </WalletBoundary>
  );
}
