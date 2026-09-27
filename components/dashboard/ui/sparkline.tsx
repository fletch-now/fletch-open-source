import type { ReactNode } from "react";

export type SparklineTone = "neutral" | "good" | "warn" | "bad";

export interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
  tone?: SparklineTone;
}

const TONE_CLASS: Record<SparklineTone, string> = {
  neutral: "text-ink-soft",
  good: "text-hood-deep",
  warn: "text-amber-700",
  bad: "text-red-700",
};

// Inline SVG, no charting library — built for the 14 to 30 points
// buildsPerDay/alertsPerDay return. A stat's real value and delta already say
// what happened; this only has to say the shape of it (Tufte: small multiples
// over a single overloaded chart; a sparkline keeps history in a KPI tile's
// footprint instead of a dial that shows one number and throws history away).
export function Sparkline({ points, width = 96, height = 28, tone = "neutral" }: SparklineProps): ReactNode {
  if (points.length === 0) {
    return null;
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  const pad = 2;
  const usableHeight = height - pad * 2;

  function y(value: number): number {
    return pad + usableHeight - ((value - min) / range) * usableHeight;
  }

  const coords = points.map(function toCoord(value, index): readonly [number, number] {
    return [index * stepX, y(value)] as const;
  });

  const linePath = coords
    .map(function toSegment([x, py], index) {
      return `${index === 0 ? "M" : "L"}${x.toFixed(1)},${py.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const last = coords[coords.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={TONE_CLASS[tone]} aria-hidden="true">
      <path d={areaPath} fill="currentColor" opacity={0.12} />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={2.2} fill="currentColor" /> : null}
    </svg>
  );
}
