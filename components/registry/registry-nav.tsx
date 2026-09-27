import { LiveActivity } from "./live-activity";
import { Suspense, type ReactElement } from "react";
import { RH_MAINNET_ID } from "@/lib/config";
import { registryVerdict } from "@/lib/registry/authority/freshness";
import { RegistryNavLinks } from "./registry-nav-links";

export type RegistrySection = "registry" | "markets" | "changes" | "lookalikes" | "issuer" | "status" | "developers" | "ai";
const DOT: Record<string, string> = { live: "bg-hood", degraded: "bg-amber-500", stale: "bg-red-600", never: "bg-ink-faint" };
interface RegistryNavProps { current?: RegistrySection; activity?: boolean }

async function StatusDot(): Promise<ReactElement | null> {
  const verdict = await registryVerdict(RH_MAINNET_ID).catch(function unavailable() {
    return null;
  });
  return verdict ? <span className={`h-2 w-2 rounded-full ${DOT[verdict.verdict] ?? DOT.never}`} title={verdict.summary} aria-hidden /> : null;
}

export function RegistryNav({ current, activity = true }: RegistryNavProps): ReactElement {
  return <>
    <RegistryNavLinks current={current} statusDot={<Suspense fallback={<span className="h-2 w-2" />}><StatusDot /></Suspense>} />
    {activity ? <LiveActivity chainId={RH_MAINNET_ID} /> : null}
  </>;
}
