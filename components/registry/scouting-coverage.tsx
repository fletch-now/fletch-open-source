import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import type { ScoutingCoverage as Coverage } from "@/lib/registry/scouting";
import { ago } from "./format";

interface Props { reading: Coverage }

export function ScoutingCoverage({ reading }: Props): ReactElement {
  let creditStatus = "Credit availability was not reported.";
  if (reading.explorer?.provider?.creditsAvailable === true) creditStatus = "Provider credits are available.";
  if (reading.explorer?.provider?.creditsAvailable === false) creditStatus = "Provider credits are exhausted.";
  const counts = [
    ["App-catalog tickers", reading.catalogSymbols],
    ["Tickers with contract candidates", reading.matchedTickers],
    ["Tickers with a bytecode-checked candidate", reading.bytecodeCheckedTickers],
    ["Tracked pool tokens awaiting a symbol", reading.pendingPoolTokens],
    ["Selected pools", reading.selectedPools],
    ["Selected pools with complete valued 24h coverage", reading.completeVolumePools],
  ] as const;
  return <section aria-label="Token scouting coverage" className="my-5 rounded-card border border-line bg-raised p-4">
    <h2 className="font-medium">Token scouting coverage</h2>
    {reading.receiptStatus === "stale" ? <p role="status" className="mt-2 text-sm text-amber-800">This coverage summary is older than two minutes. The last measured counts are retained.</p> : null}
    <p className="mt-2 text-sm leading-6">Every catalog ticker enters the candidate search. Pool discovery and candidate comparison run each minute; selected pool state refreshes every 45 seconds. Bounded passes rotate through older candidates and retain their progress.</p>
    <p className="mt-2 text-sm leading-6 text-ink-soft">A ticker match identifies candidates. Bytecode confirms a contract exists; it does not establish that Robinhood&apos;s app refers to that contract. Price and volume require their own current pool and swap observations.</p>
    <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{counts.map(([label, count]) => <div key={label}><dt className="text-xs text-ink-soft">{label}</dt><dd className="mt-1 font-mono text-lg">{count.toLocaleString("en-US")}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-ink-soft">Source: Fletch&apos;s catalog, contract, pool and swap records. Measured <time dateTime={reading.measuredAt} title={reading.measuredAt}>{ago(new Date(reading.measuredAt))}</time>. The pending-symbol count covers recorded pricing tokens; the metadata queue also reads both pool currencies. Job ages and metadata errors appear in the job table; complete historical coverage can still have a delayed live tail.</p>
    {reading.explorer ? <div className="mt-4 border-t border-line pt-3 text-sm leading-6">
      <h3 className="font-medium">On-chain contract discovery</h3>
      <p>{reading.explorer.searchesCompleted} catalog searches completed within six hours; {reading.explorer.searchesDue} due or incomplete. {reading.explorer.candidateContracts.toLocaleString("en-US")} candidate contracts recorded; {reading.explorer.pendingContractChecks.toLocaleString("en-US")} await current RPC metadata.</p>
      <p className="text-ink-soft">Searches run in bounded batches each minute. A new catalog observation makes that ticker due sooner. Explorer matches remain candidates until the on-chain reads finish.</p>
      <p className="text-xs text-ink-soft">Last search response: {reading.explorer.lastSearchAt ? <time dateTime={reading.explorer.lastSearchAt}>{ago(new Date(reading.explorer.lastSearchAt))}</time> : "not observed"}.</p>
      {reading.explorer.provider ? <p className="mt-2 text-xs text-ink-soft">The chain explorer last returned HTTP {reading.explorer.provider.httpStatus}. {creditStatus} Response observed <time dateTime={reading.explorer.provider.observedAt}>{ago(new Date(reading.explorer.provider.observedAt))}</time>. The source index time is unpublished.</p> : <p className="text-xs text-ink-soft">Explorer response status has not been recorded yet.</p>}
    </div> : null}
    {reading.unmatchedSymbols.length ? <details className="mt-3 text-sm"><summary className="cursor-pointer">{reading.unmatchedSymbols.length} catalog tickers have no on-chain match found</summary><ul className="mt-2 flex max-h-48 flex-wrap gap-3 overflow-y-auto">{reading.unmatchedSymbols.map(symbol => <li key={symbol}><Link className="underline" href={`/registry/markets?q=${encodeURIComponent(symbol)}`}>{symbol}</Link></li>)}</ul></details> : null}
  </section>;
}
