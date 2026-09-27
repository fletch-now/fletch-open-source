import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import type { ContractSearchPage } from "@/lib/registry/contract-search";
import { RH_MAINNET_ID } from "@/lib/config";
import { TrustBadge } from "./trust-badge";
import { LiveAge } from "./live-reading";
import { ago, shortHex } from "./format";

const sourceLabels = {
  asset_list: "Registry asset record",
  contract_metadata: "Contract metadata",
  lookalike_scan: "Lookalike scan",
  explorer_candidate: "Explorer candidate",
};

interface Props { result: ContractSearchPage; expanded: boolean; params: Record<string, string> }

export function ContractSearchResults({ result, expanded, params }: Props): ReactElement {
  function href(page: number): string {
    return `/registry/markets?${new URLSearchParams({ ...params, searchPage: String(page) })}#contract-results`;
  }
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  return <details id="contract-results" key={`${result.query}:${result.page}`} open={expanded} className="group mt-3 rounded-xl border border-line bg-raised/50">
    <summary className="flex min-h-12 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90 motion-reduce:transition-none">▸</span>
      <span className="font-medium">{result.similar ? "Similar names" : "Matching contracts"} <span className="font-mono tabular-nums">({result.total.toLocaleString("en-US")})</span></span>
      <span className="text-ink-soft">Across the registry</span>
      <span className="ml-auto text-ink-soft group-open:hidden">Show results</span><span className="ml-auto hidden text-ink-soft group-open:inline">Hide results</span>
    </summary>
    <div className="border-t border-line px-4 pb-3">
      <p className="py-3 text-[12px] leading-5 text-ink-soft">{result.similar ? "No exact text match. These names are similar; check the full address before using a contract." : "Search includes recorded contracts outside the tracked markets. Open a contract to inspect its readings. Market filters below apply to the market table."}</p>
      {result.items.length ? <ul className="max-h-80 divide-y divide-line overflow-y-auto overscroll-contain" aria-label="Matching token contracts">
        {result.items.map(function match(token): ReactElement {
          return <li key={token.address} className="grid min-w-0 gap-1.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><Link href={`/registry/markets/${token.address}`} className="break-words text-[14px] font-medium underline-offset-4 hover:underline">{token.symbol ?? "Metadata pending"}{token.name ? <span className="ml-2 font-normal text-ink-soft">{token.name}</span> : null}</Link><TrustBadge level={token.trust} /></div>
              <p className="mt-1 font-mono text-[11px] text-ink-soft" title={token.address}><span className="sm:hidden">{shortHex(token.address, 10, 8)}</span><span className="hidden sm:inline">{token.address}</span>{token.isin ? <span className="ml-3">{token.isin}</span> : null}</p>
              <p className="mt-1 text-[11px] text-ink-soft">{sourceLabels[token.source]}. {token.observedAt ? <>Observed <LiveAge at={token.observedAt} initialLabel={ago(new Date(token.observedAt))} />.</> : "Metadata not checked yet."}{token.source === "explorer_candidate" ? " Reported identity; contract check pending." : null}</p>
            </div>
            <Link href={`/registry/markets?q=${token.address}`} className="inline-flex min-h-11 items-center text-[12px] underline underline-offset-4 sm:justify-end">{token.trackedMarket ? "View market" : "Check market readings"}</Link>
          </li>;
        })}
      </ul> : <p className="py-3 text-[13px] text-ink-soft">{result.total ? "This result page is empty. Return to the first page." : "No recorded contract matches. Try its full address or another name. A missing search result does not prove that a contract does not exist."}</p>}
      <nav aria-label="Contract search pages" className="flex flex-wrap items-center gap-4 border-t border-line pt-2 text-[12px]">
        {result.page > 1 ? <Link href={href(1)} className="inline-flex min-h-11 items-center underline">First</Link> : null}
        {result.page > 1 ? <Link href={href(result.page - 1)} className="inline-flex min-h-11 items-center underline">Previous</Link> : null}
        <span className="text-ink-soft">Page {result.page} of {pages}</span>
        {result.page < pages ? <Link href={href(result.page + 1)} className="inline-flex min-h-11 items-center underline">Next</Link> : null}
        <a href={`/api/v1/chains/${RH_MAINNET_ID}/search?${new URLSearchParams({ q: result.query, page: String(result.page), limit: String(result.pageSize) })}`} className="ml-auto inline-flex min-h-11 items-center underline">Search JSON</a>
      </nav>
    </div>
  </details>;
}
