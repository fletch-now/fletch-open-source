import "@/components/registry/table-shell.css";
import type { ReactElement, ReactNode } from "react";
import { RegistryTableScope } from "@/components/registry/table-shell";
import { RegistryHeader } from "@/components/registry/registry-header";
import { RegistryNav } from "@/components/registry/registry-nav";
import { LiveActivity } from "@/components/registry/live-activity";
import { RH_MAINNET_ID } from "@/lib/config";
import { RefreshReading } from "@/components/registry/refresh-reading";

// Each visible tab reads the current database snapshot. Per-reading database
// caches still bound query work; a static route must not outlive its metrics.
export const dynamic = "force-dynamic";

export default function RegistryLayout({ children }: { children: ReactNode }): ReactElement {
  return <RegistryTableScope>
    <RefreshReading automatic controls={false} />
    <RegistryHeader />
    <RegistryNav activity={false} />
    <LiveActivity chainId={RH_MAINNET_ID} />
    {children}
  </RegistryTableScope>;
}
