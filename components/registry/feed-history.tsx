import type { FeedRound } from "@/lib/registry/authority/read";
import { ago } from "@/components/registry/format";
import { LineChart, type ChartSeries } from "@/components/registry/line-chart";

interface FeedHistoryProps {
  symbol: string;
  chainId: number;
  // Newest first, as feedRoundsFor returns them.
  rounds: FeedRound[];
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function FeedHistory({ symbol, chainId, rounds }: FeedHistoryProps) {
  const ordered = [...rounds].reverse();
  const values = ordered.map((round) => Number(round.answer));
  const low = Math.min(...values);
  const high = Math.max(...values);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const change = first && last ? ((Number(last.answer) - Number(first.answer)) / Number(first.answer)) * 100 : 0;
  const series: ChartSeries[] = [{ label: `${symbol} feed price`, stroke: "#00a806", fill: "rgba(0,200,5,0.08)", values }];

  return (
    <section id="feed" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">Chainlink feed history</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        The last {ordered.length} rounds the feed for {symbol} posted, price × multiplier in USD, read from the aggregator on
        chain {chainId} and kept by the registry daemon. Low {money(low)}, high {money(high)}, {change >= 0 ? "up" : "down"}{" "}
        {Math.abs(change).toFixed(2)}% across the window.{" "}
        <a href={`/api/v1/chains/${chainId}/assets/${encodeURIComponent(symbol)}/feed/rounds`} className="underline underline-offset-4 hover:text-ink">
          Every round as JSON
        </a>
        .
      </p>
      <div className="mt-4 overflow-hidden rounded-card border border-line bg-raised px-5 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[12px] text-ink-faint">
          <span>{first ? `${money(Number(first.answer))} · ${ago(first.updatedAt)}` : ""}</span>
          <span className="text-ink">{last ? `${money(Number(last.answer))} · ${ago(last.updatedAt)}` : ""}</span>
        </div>
        <div className="mt-2">
          <LineChart series={series} ariaLabel={`${symbol} feed price over the last ${ordered.length} rounds`} />
        </div>
      </div>
    </section>
  );
}
