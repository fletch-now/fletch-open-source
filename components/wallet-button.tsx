"use client";

import dynamic from "next/dynamic";
import { WalletBoundary } from "@/components/wallet-boundary";

// Reserves the button's exact footprint so the header does not reflow when the
// wallet bundle finishes loading.
function Placeholder() {
  return <span className="h-9 w-[132px] shrink-0" aria-hidden="true" />;
}

const WalletIsland = dynamic(
  function load() {
    return import("@/components/wallet-island").then(function pick(m) {
      return m.WalletIsland;
    });
  },
  { ssr: false, loading: Placeholder },
);

export function WalletButton({ tone }: { tone?: "light" | "night" }) {
  return (
    <WalletBoundary>
      <WalletIsland tone={tone} />
    </WalletBoundary>
  );
}
