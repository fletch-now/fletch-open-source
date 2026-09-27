import { TableShell } from "@/components/registry/table-shell";
import { daysBetween, type HistoryCoverage, type HistoryWindow, type StateDay } from "@/lib/registry/authority/state-daily";
import { multiplierText, percentText, priceText, supplyText } from "@/components/registry/format";
import { ChartLegend, LineChart, type ChartSeries } from "@/components/registry/line-chart";

interface HistoryPanelProps {
  symbol: string;
  chainId: number;
  decimals: number;
  // Oldest first, as historyFor returns them.
  days: StateDay[];
  // The window the rows were read for, which is the charts' x axis.
  range: HistoryWindow;
  coverage: HistoryCoverage;
}

const TABLE_DAYS = 14;

const FEED_STROKE = "#00a806";
const DEX_STROKE = "#39423b";

// One slot per UTC day in the window, so a day with no row is a null the chart
// breaks the line across rather than a day the line silently steps over.
function slots(days: StateDay[], range: HistoryWindow): Array<StateDay | null> {
  const byDay = new Map(days.map((day) => [day.day, day]));
  return daysBetween(range).map((day) => byDay.get(day) ?? null);
}

function numbers(days: Array<StateDay | null>, read: (day: StateDay) => string | null): Array<number | null> {
  return days.map(function value(day) {
    const raw = day === null ? null : read(day);
    return raw === null ? null : Number(raw);
  });
}

function has(values: Array<number | null>): boolean {
  return values.some((value) => value !== null);
}

interface Extent {
  low: number;
  high: number;
}

function extentOf(series: ChartSeries[]): Extent | null {
  const readings = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  if (readings.length === 0) {
    return null;
  }
  return { low: Math.min(...readings), high: Math.max(...readings) };
}

function flagText(day: StateDay): string {
  const flags = [day.tokenPaused ? "token paused" : "", day.oraclePaused ? "oracle paused" : "", day.apiTradingHalt ? "trading halted" : "", day.feedStale ? "feed stale" : ""].filter(Boolean);
  return flags.length === 0 ? "—" : flags.join(", ");
}

function coverageText(coverage: HistoryCoverage): string {
  if (coverage.days === 0) {
    return "No day has been snapshotted yet.";
  }
  if (coverage.days === 1) {
    return `One day on record, ${coverage.firstDay}: the first snapshot. The chart fills in as days pass.`;
  }
  return `${coverage.days} days on record, ${coverage.firstDay} to ${coverage.latestDay}. There is nothing before ${coverage.firstDay}: that is when the daily snapshot began.`;
}

interface ScaleProps {
  extent: Extent | null;
  format: (value: number) => string;
  range: HistoryWindow;
}

// A line with no numbers on it is a shape, not a quantity: the low and high of
// what is plotted, and the days the x axis runs between.
function ChartScale({ extent, format, range }: ScaleProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 font-mono text-[12px] text-ink-faint">
      <span className="text-ink">{extent === null ? "—" : `low ${format(extent.low)} · high ${format(extent.high)}`}</span>
      <span>
        {range.from} → {range.to}
      </span>
    </div>
  );
}

export function HistoryPanel({ symbol, chainId, decimals, days, range, coverage }: HistoryPanelProps) {
  const perDay = slots(days, range);
  const feed = numbers(perDay, (day) => day.feedPrice);
  const dex = numbers(perDay, (day) => day.dexPriceUsd);
  const premium = numbers(perDay, (day) => day.dexPremiumPct);
  const priceSeries: ChartSeries[] = [
    { label: "Chainlink feed", stroke: FEED_STROKE, fill: "rgba(0,200,5,0.08)", values: feed },
    { label: "DEX price", stroke: DEX_STROKE, values: dex },
  ].filter((line) => has(line.values));
  const premiumSeries: ChartSeries[] = [{ label: "DEX premium to feed", stroke: DEX_STROKE, values: premium }];
  const recent = [...days].reverse().slice(0, TABLE_DAYS);
  const jsonHref = `/api/v1/chains/${chainId}/assets/${encodeURIComponent(symbol)}/history`;

  return (
    <section id="history" className="mt-14 scroll-mt-24">
      <h2 className="text-[18px] font-medium text-ink">History</h2>
      <p className="mt-1 max-w-2xl text-[13.5px] leading-6 text-ink-soft">
        Every hour Fletch copies every live number it holds for {symbol} into that UTC day&apos;s row, so a question about a
        past day has a source. Feed is the Chainlink aggregator&apos;s price, which already includes the multiplier; DEX is the
        deepest pool of any DEX read that day; Premium is how far that pool sat above (+) or below (−) the feed. Each row is one reading, the last one taken that day, not a
        closing price. {coverageText(coverage)}{" "}
        <a href={jsonHref} className="underline underline-offset-4 hover:text-ink">
          Every day as JSON
        </a>
        {coverage.latestDay ? (
          <>
            , or one day with{" "}
            <a href={`${jsonHref}?at=${coverage.latestDay}`} className="font-mono underline underline-offset-4 hover:text-ink">
              ?at={coverage.latestDay}
            </a>
          </>
        ) : null}
        .
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-card border border-line bg-raised px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="mono-label">price per day</p>
            <ChartLegend series={priceSeries} />
          </div>
          {priceSeries.length === 0 ? (
            <p className="mt-3 text-[13px] text-ink-soft">No feed or pool price has been snapshotted for {symbol}.</p>
          ) : (
            <div className="mt-2">
              <ChartScale extent={extentOf(priceSeries)} format={priceText} range={range} />
              <LineChart series={priceSeries} ariaLabel={`${symbol} feed and DEX price per day`} />
            </div>
          )}
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-raised px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="mono-label">dex premium to feed, per day</p>
            <span className="text-[11.5px] text-ink-faint">dashed line: zero, the pool price matched the feed · a break in the line is a day with no reading</span>
          </div>
          {has(premium) ? (
            <div className="mt-2">
              <ChartScale extent={extentOf(premiumSeries)} format={percentText} range={range} />
              <LineChart series={premiumSeries} ariaLabel={`${symbol} DEX premium to the Chainlink feed per day`} baselineAt={0} />
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-ink-soft">No dollar-priced pool has been read for {symbol}, so there is no premium to plot.</p>
          )}
        </div>
      </div>

      <TableShell label="History Panel" className="mt-4">
        <table className="w-full min-w-[860px] text-left">
          <thead>
            <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
              <th className="px-4 py-3 font-medium">Day</th>
              <th className="px-4 py-3 text-right font-medium">Multiplier</th>
              <th className="px-4 py-3 text-right font-medium">Feed</th>
              <th className="px-4 py-3 text-right font-medium">DEX</th>
              <th className="px-4 py-3 text-right font-medium">Premium</th>
              <th className="px-4 py-3 text-right font-medium">Supply</th>
              <th className="px-4 py-3 text-right font-medium">Lookalikes</th>
              <th className="px-4 py-3 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {recent.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-[13.5px] text-ink-soft">
                  The daily snapshot has not run against this database yet.
                </td>
              </tr>
            ) : null}
            {recent.map(function renderDay(day) {
              return (
                <tr key={day.id}>
                  <td className="px-4 py-2.5 font-mono text-[12.5px] text-ink">{day.day}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{multiplierText(day.uiMultiplier)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink">{priceText(day.feedPrice)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{priceText(day.dexPriceUsd)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{percentText(day.dexPremiumPct)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{supplyText(day.totalSupplyRaw?.split(".")[0], decimals)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[12.5px] tabular-nums text-ink-soft">{day.lookalikes === null ? "—" : day.lookalikes.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 text-[12.5px] text-ink-soft">{flagText(day)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>
      <p className="mt-2 text-[12px] text-ink-faint">
        An em dash means no recorded reading for that figure. The JSON includes the timestamp of each observation.
      </p>
    </section>
  );
}
