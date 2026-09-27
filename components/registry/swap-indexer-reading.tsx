import { TableShell } from "@/components/registry/table-shell";
import type { SwapIndexerReading } from "@/lib/registry/authority/market-swap-status";
import Link from "@/components/ui/navigation-link";
import { indexedAgeText, indexedBlockText, indexedTimeText, swapCoverageNote, swapWindowText } from "./swap-indexer-format";

interface Props {
  reading: SwapIndexerReading;
  chainId: number;
  showStatusLink?: boolean;
}

export function SwapIndexerPanel({ reading, chainId, showStatusLink = true }: Props): React.ReactElement {
  return (
    <section aria-label="Swap indexer reading" className="mt-4 rounded-card border border-line bg-raised px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium text-ink">Swap indexer</h2>
        <span className="text-[12px] text-ink-soft">Live tail and history backfill</span>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-soft">{swapCoverageNote(reading)}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-3 text-[12px] sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="mono-label">newest counted block</dt>
          <dd className="mt-1 break-words font-mono tabular-nums text-ink">{indexedBlockText(reading.newestCountedBlock)}</dd>
          <dd className="mt-1 text-ink-soft">{indexedTimeText(reading.newestCountedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="mono-label">lag</dt>
          <dd className="mt-1 break-words text-ink">{indexedBlockText(reading.lagBlocks)} blocks behind the recorded head</dd>
          <dd className="mt-1 text-ink-soft">Indexed block age: {indexedAgeText(reading.lagSeconds)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="mono-label">recorded chain head</dt>
          <dd className="mt-1 break-words font-mono tabular-nums text-ink">{indexedBlockText(reading.headBlock)}</dd>
          <dd className="mt-1 text-ink-soft">Read {indexedTimeText(reading.headReadAt)}</dd>
        </div>
      </dl>
      {reading.catalogStatus === "unavailable" ? <p role="status" className="mt-3 text-[13px] text-ink-soft">Pool catalog coverage has not been published yet.</p> : null}
      {reading.catalogStatus === "stale" ? <p role="status" className="mt-3 text-[13px] text-amber-800">Pool catalog counts are older than two minutes. Live indexing is checked separately above.</p> : null}
      {reading.catalogMeasuredAt ? <p className="mt-3 text-[12px] text-ink-soft">Pool catalog measured <time dateTime={reading.catalogMeasuredAt}>{indexedTimeText(reading.catalogMeasuredAt)}</time>.</p> : null}
      <TableShell label="Swap Indexer Reading" className="mt-4">
        <table className="w-full text-left text-[11.5px] tabular-nums sm:text-[12px]">
          <caption className="sr-only">Canonical pool catalog by tier; current work targets the selected priority set</caption>
          <thead>
            <tr className="border-b border-line text-ink-soft">
              <th scope="col" className="pb-2 pr-2 font-normal">Tier</th>
              <th scope="col" className="px-2 pb-2 text-right font-normal">Catalog pools</th>
              <th scope="col" className="px-2 pb-2 text-right font-normal">Enrolled</th>
              <th scope="col" className="pb-2 pl-2 text-right font-normal">24h complete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {reading.tiers.map(function tierRow(tier) {
              return (
                <tr key={tier.tier}>
                  <th scope="row" className="py-2 pr-2 font-normal capitalize text-ink">{tier.tier}</th>
                  <td className="px-2 py-2 text-right font-mono text-ink">{tier.totalPools.toLocaleString("en-US")}</td>
                  <td className="px-2 py-2 text-right font-mono text-ink">{tier.enrolledPools.toLocaleString("en-US")}</td>
                  <td className="py-2 pl-2 text-right font-mono text-ink">{tier.complete24hPools.toLocaleString("en-US")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
      <dl className="mt-3 space-y-1 text-[11.5px] text-ink-soft">
        <div><dt className="inline">Requested rolling window: </dt><dd className="inline">{swapWindowText(reading.windowStartAt, reading.windowEndAt)}</dd></div>
        <div><dt className="inline">This reading: </dt><dd className="inline">{indexedTimeText(reading.checkedAt)}</dd></div>
      </dl>
      <p className="mt-2 text-[11.5px] leading-5 text-ink-soft">
        Enrolled pools may still have gaps. Complete coverage is required before counts are published;
        stale windows and missing observations stay unavailable. Volume requires a supported historical quote method, recorded with the metric.
        {" "}<a href={`/api/v1/chains/${chainId}/status`} className="underline underline-offset-4 hover:text-ink">JSON reading</a>
        {showStatusLink ? <> · <Link href="/registry/status" className="underline underline-offset-4 hover:text-ink">Registry status</Link></> : null}
      </p>
    </section>
  );
}
