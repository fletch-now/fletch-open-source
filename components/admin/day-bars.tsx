import type { ReactNode } from "react";
import type { DayPoint } from "@/lib/admin/queries";

interface DayBarsProps {
  points: DayPoint[];
  // What `ok` and `bad` mean for this series, for the legend.
  okLabel: string;
  badLabel: string;
}

// Fourteen days of stacked bars, drawn as divs so the page ships no chart
// library. The green part is what went right, the red part what failed; grey is
// everything else (queued, pending, running). Height is relative to the busiest
// day in the window, and a day with nothing shows a hairline so the gap reads as
// "zero", not "missing".
export function DayBars({ points, okLabel, badLabel }: DayBarsProps): ReactNode {
  const max = Math.max(1, ...points.map((point) => point.total));
  return (
    <div>
      <div className="flex h-24 items-end gap-1">
        {points.map(function renderBar(point) {
          const height = (point.total / max) * 100;
          const okShare = point.total === 0 ? 0 : (point.ok / point.total) * 100;
          const badShare = point.total === 0 ? 0 : (point.bad / point.total) * 100;
          return (
            <div
              key={point.day}
              className="flex h-full flex-1 flex-col justify-end"
              title={`${point.day}: ${point.total} total, ${point.ok} ${okLabel}, ${point.bad} ${badLabel}`}
            >
              <div className="flex w-full flex-col overflow-hidden rounded-sm bg-panel" style={{ height: `${Math.max(2, height)}%` }}>
                <div className="w-full bg-ink/15" style={{ flexGrow: 100 - okShare - badShare }} />
                <div className="w-full bg-red-500/70" style={{ flexGrow: badShare }} />
                <div className="w-full bg-hood" style={{ flexGrow: okShare }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-ink-faint">
        <span>{points[0]?.day.slice(5)}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-hood" /> {okLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm bg-red-500/70" /> {badLabel}
          </span>
        </span>
        <span>{points[points.length - 1]?.day.slice(5)}</span>
      </div>
    </div>
  );
}
