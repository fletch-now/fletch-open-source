import { LiveAge } from "./live-reading";
import Link from "@/components/ui/navigation-link";
import type { ReactElement } from "react";
import { appStatusLabel, type AppCatalogStatus } from "@/lib/registry/app-catalog-model";
import type { CatalogReading } from "@/lib/registry/app-catalog";
import { publicDiagnostic } from "@/lib/public-copy";
import { ago } from "./format";
import { InfoTip } from "./info-tip";

interface AppStatusProps { reading: AppCatalogStatus; compact?: boolean; stockToken?: { source: string | null; observedAt: string | null; verified: boolean } }

export function AppStatus({ reading, compact = false, stockToken }: AppStatusProps): ReactElement {
  const details = [reading.reason, reading.match === "ticker_only" ? "Ticker match only. This catalog does not supply a contract address." : null].filter(Boolean).join(" ");
  if (compact && reading.status === "not_covered" && stockToken?.source) return <div className="registry-app-status text-[12px] leading-5" data-app-status={reading.status}>
    <p className="flex items-start gap-1 font-medium text-ink">Stock Token catalog <InfoTip label="Stock Token catalog scope" text="Robinhood's asset list records this Stock Token. The separate crypto catalog does not determine its app availability. Membership does not establish current trading access for an account." /></p>
    <p className="text-ink-soft"><a href={stockToken.source} className="underline underline-offset-4">Robinhood asset list</a> · {stockToken.observedAt ? <LiveAge at={stockToken.observedAt} initialLabel={ago(new Date(stockToken.observedAt))} /> : "observation time unavailable"}</p>
  </div>;
  return <div className={`${compact ? "registry-app-status" : "mt-3"} text-[12px] leading-5`} data-app-status={reading.status}>
    <p className="flex items-start gap-1 font-medium text-ink">{appStatusLabel(reading.status)}{compact ? <InfoTip label="About Robinhood crypto status" text={details} /> : null}</p>
    {!compact ? <p className="text-ink-soft">{details}</p> : null}
    <p className="text-ink-soft"><a href={reading.source} className="underline underline-offset-4">Robinhood crypto catalog</a> · {reading.observedAt ? <LiveAge at={reading.observedAt} initialLabel={ago(new Date(reading.observedAt))} /> : "not checked"}</p>
    {reading.stale || reading.error ? <p role="status" className="text-amber-800">Last known status. {publicDiagnostic(reading.error ?? "Observation older than 60 seconds.")}</p> : null}
    {!compact && reading.pairs.length ? <details className="mt-2"><summary className="cursor-pointer underline underline-offset-4">Account availability and order limits</summary>{reading.pairs.map((pair) => <div key={pair.id} className="mt-2 break-words"><p>{pair.symbol}: {Object.entries(pair.tradability_by_account_type).map(([account, value]) => `${account}: ${value}`).join("; ")}.</p><p>Order size: {pair.min_order_size} to {pair.max_order_size}. Stablecoin: {pair.is_stablecoin ? "yes" : "no"}.</p></div>)}</details> : null}
  </div>;
}

export function AppCatalogHealth({ reading }: { reading: CatalogReading }): ReactElement {
  return <details className="my-3 rounded-lg border border-line bg-raised px-3 py-2 text-[13px] leading-5" aria-label="Robinhood crypto catalog sync">
    <summary className="cursor-pointer">Robinhood crypto catalog · {reading.stale || reading.error ? "needs attention" : "current"} · {reading.observedAt ? <LiveAge at={reading.observedAt} initialLabel={ago(new Date(reading.observedAt))} /> : "not checked"}</summary>
    <p className="mt-2">Fletch checks the <a href={reading.source} className="underline">public crypto catalog</a> every 15 seconds. It covers crypto availability; Stock Tokens have a separate asset list. A price feed does not mean trading is available.</p>
    {reading.error || reading.stale ? <p role="status" className="mt-2 text-amber-800">{publicDiagnostic(reading.error ?? "The sync is stale. The last known snapshot is retained.")}</p> : null}
    <p className="mt-2 text-ink-soft">The endpoint is unofficial and can restrict access. Responses can vary by client. These are observed catalog fields, without an endorsement or a prediction of future trading.</p>
    <Link href="/dashboard/watch/new?kind=listing_event" className="mt-2 inline-block underline">Watch catalog changes</Link>
  </details>;
}
