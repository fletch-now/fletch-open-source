// One server-drawn line chart, shared by the feed-history section and the
// per-asset history section: an SVG built from rows the daemon wrote, so it
// needs no script and prints in the share card's colours. Several series share
// one vertical scale, which is what makes a feed price and a DEX price
// comparable when they are drawn over each other. Not the KPI-tile
// components/dashboard/ui/sparkline.tsx: this one is full width, multi-series
// and legended.

export interface ChartSeries {
  label: string;
  stroke: string;
  // Set to fill the area under the line; leave unset for an overlay.
  fill?: string;
  // One value per position, null where the day carries no reading.
  values: Array<number | null>;
}

interface LineChartProps {
  series: ChartSeries[];
  ariaLabel: string;
  height?: number;
  // A horizontal rule always kept in view, e.g. 0 on a premium chart.
  baselineAt?: number;
}

interface Point {
  x: number;
  y: number;
}

const WIDTH = 720;
const PAD = 8;
const DEFAULT_HEIGHT = 140;

function path(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
}

// The line closed down to the floor, so the area under it can be filled.
function areaPath(points: Point[], floor: number): string {
  return `${path(points)} L${points[points.length - 1].x.toFixed(1)},${floor} L${points[0].x.toFixed(1)},${floor} Z`;
}

// Runs of consecutive readings. A gap in a series is a day the figure was not
// read, and a line drawn straight across it would invent the missing days.
function segments(values: Array<number | null>, place: (value: number, index: number) => Point): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  values.forEach(function step(value, index) {
    if (value === null) {
      if (run.length > 0) {
        runs.push(run);
        run = [];
      }
      return;
    }
    run.push(place(value, index));
  });
  if (run.length > 0) {
    runs.push(run);
  }
  return runs;
}

export function LineChart({ series, ariaLabel, height = DEFAULT_HEIGHT, baselineAt }: LineChartProps) {
  const readings = series.flatMap((line) => line.values.filter((value): value is number => value !== null));
  if (readings.length === 0) {
    return null;
  }
  const bounds = baselineAt === undefined ? readings : [...readings, baselineAt];
  const low = Math.min(...bounds);
  const span = Math.max(...bounds) - low || 1;
  const columns = Math.max(...series.map((line) => line.values.length));
  const x = (index: number): number => PAD + (columns < 2 ? 0.5 : index / (columns - 1)) * (WIDTH - PAD * 2);
  const y = (value: number): number => PAD + (1 - (value - low) / span) * (height - PAD * 2);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${height}`} className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      {baselineAt === undefined ? null : (
        <line x1={PAD} x2={WIDTH - PAD} y1={y(baselineAt)} y2={y(baselineAt)} stroke="rgb(22 38 26 / 0.22)" strokeWidth={1} strokeDasharray="3 4" />
      )}
      {series.map(function drawSeries(line) {
        const runs = segments(line.values, (value, index) => ({ x: x(index), y: y(value) }));
        const last = runs[runs.length - 1]?.slice(-1)[0];
        return (
          <g key={line.label}>
            {runs.map(function drawRun(run, index) {
              const key = `${line.label}-${index}`;
              if (run.length === 1) {
                return <circle key={key} cx={run[0].x} cy={run[0].y} r={3} fill={line.stroke} />;
              }
              return (
                <g key={key}>
                  {line.fill ? <path d={areaPath(run, height - PAD)} fill={line.fill} stroke="none" /> : null}
                  <path d={path(run)} fill="none" stroke={line.stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              );
            })}
            {last ? <circle cx={last.x} cy={last.y} r={4} fill={line.stroke} /> : null}
          </g>
        );
      })}
    </svg>
  );
}

interface ChartLegendProps {
  series: ChartSeries[];
}

export function ChartLegend({ series }: ChartLegendProps) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[11.5px] text-ink-faint">
      {series.map(function renderKey(line) {
        return (
          <span key={line.label} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-[2px] w-4 rounded-full" style={{ backgroundColor: line.stroke }} />
            {line.label}
          </span>
        );
      })}
    </div>
  );
}
