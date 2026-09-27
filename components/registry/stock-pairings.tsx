import { LiveAge } from "./live-reading";
import type { ReactElement } from "react";
import type { StockPairing, StockPairingSummary } from "@/lib/registry/stock-pairings";
import { ago, shortHex } from "./format";

interface StockPairingsProps { pairs: StockPairing[]; summary?: StockPairingSummary; compact?: boolean }

export function StockPairings({ pairs, summary, compact = false }: StockPairingsProps): ReactElement | null {
  if (!summary?.totalPools && !pairs.length) return null;
  const resolved = pairs.filter((pair) => pair.communitySymbol);
  const displayed = resolved.slice(0, compact ? 1 : 3);
  const stockAddresses = new Set(displayed.map((pair) => pair.stockAddress));
  const sharedStockAddress = stockAddresses.size === 1 ? displayed[0].stockAddress : null;
  const observed = summary?.observedSwapPools ?? pairs.filter((pair) => pair.lastSwapAt).length;
  const latestAt = summary?.latestSwapAt ?? pairs.find((pair) => pair.lastSwapAt)?.lastSwapAt;
  const pending = summary?.pendingCounterparties ?? pairs.filter((pair) => !pair.communitySymbol).length;
  return <section id="pairings" aria-labelledby="stock-pairing-title" className="mt-6 scroll-mt-20 rounded-xl border border-line bg-raised p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="stock-pairing-title" className="text-[17px] font-medium">Stock and community pairs</h2>{summary ? <a href={summary.url} className="text-[13px] underline underline-offset-4">All pools as JSON</a> : null}</div>
    <p className="mt-1 text-[13px] leading-5 text-ink-soft">{summary ? `${summary.totalPools.toLocaleString("en-US")} recorded pools across ${summary.counterparties.toLocaleString("en-US")} counterparties.` : `${pairs.length} recorded pairings.`} {pending ? `${pending.toLocaleString("en-US")} counterparties still need token metadata.` : ""}</p>
    {observed ? <p className="mt-2 text-[13px]">{observed} pools have recorded swaps.{latestAt ? <> Latest swap <LiveAge at={latestAt} initialLabel={ago(new Date(latestAt))} />.</> : null}</p> : <p className="mt-2 text-[13px] text-ink-soft">No recorded swap establishes a leading pair. Pool creation alone does not show trading activity or liquidity.</p>}
    {sharedStockAddress ? <p className="mt-2 text-[12px] text-ink-soft">Stock contract: <a href={`/registry/markets/${sharedStockAddress}`} title={sharedStockAddress} className="font-mono underline underline-offset-4">{shortHex(sharedStockAddress)}</a></p> : null}
    {displayed.length ? <ul className="mt-3 divide-y divide-line">{displayed.map((pair) => <li key={pair.id ?? `${pair.poolId}:${pair.stockAddress}`} className="flex flex-wrap items-start justify-between gap-2 py-3 text-[13px]">
      <div><a className="font-medium underline underline-offset-4" href={`/registry/markets?view=pools&q=${encodeURIComponent(pair.poolId)}`}>{pair.stockSymbol}/{pair.communitySymbol}</a><p className="mt-1 text-ink-soft">{pair.communityName ?? shortHex(pair.communityAddress)} · {pair.venue.replaceAll("_", " ")}</p><p className="mt-1 text-[12px] text-ink-soft">Token metadata {pair.observedAt ? <LiveAge at={pair.observedAt} initialLabel={ago(new Date(pair.observedAt))} /> : "not checked"} · {pair.metadataStatus}</p></div>
      <div className="text-[12px]"><p className="font-medium">{pair.stockVerdict === "canonical" ? "Verified Stock Token address" : `${pair.stockVerdict} stock address`}</p>{!sharedStockAddress ? <a href={`/registry/markets/${pair.stockAddress}`} title={pair.stockAddress} className="font-mono underline underline-offset-4">{shortHex(pair.stockAddress)}</a> : null}{pair.stockVerdict !== "canonical" ? <p className="mt-1"><a className="underline" href={`/registry/markets/${pair.canonicalAddress}`}>Compare verified address</a></p> : null}</div>
    </li>)}</ul> : null}
    <details className="mt-3 text-[12px] leading-5 text-ink-soft"><summary className="cursor-pointer">Source and address checks</summary><p className="mt-2">Recorded factory pools and contract metadata. The stock-side verdict compares each address with Robinhood&apos;s verified Stock Token list. A matching ticker on another address is a lookalike; it does not establish intent. Pairs are ordered by latest recorded swap, then resolved metadata and pool creation.</p>{summary ? <p className="mt-1">Pool summary read <LiveAge at={summary.asOf} initialLabel={ago(new Date(summary.asOf))} />. Token metadata ages are shown separately.</p> : null}</details>
  </section>;
}
