import type { ReactNode } from "react";

export interface TimeProps {
  at: Date;
  mode?: "relative" | "absolute";
  className?: string;
}

function formatAbsolute(at: Date): string {
  return at.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatRelative(at: Date): string {
  const diffMs = Date.now() - at.getTime();
  const suffix = diffMs < 0 ? "from now" : "ago";
  const seconds = Math.abs(Math.round(diffMs / 1000));
  if (seconds < 45) {
    return diffMs < 0 ? "in a moment" : "just now";
  }
  if (seconds < 3_600) {
    return `${Math.round(seconds / 60)}m ${suffix}`;
  }
  if (seconds < 86_400) {
    return `${Math.round(seconds / 3_600)}h ${suffix}`;
  }
  if (seconds < 86_400 * 30) {
    return `${Math.round(seconds / 86_400)}d ${suffix}`;
  }
  return formatAbsolute(at);
}

// Relative by default — faster to scan a list with — but the exact instant is
// always one hover or focus away, in `title`, and always machine-readable in
// `dateTime` for anything that needs to correlate against a log (Cloudscape
// timestamp pattern). Numeric-only absolute dates are locale-ambiguous
// (03/04 is a different day in the US and Europe), so `formatAbsolute` never
// renders one — it spells the month.
export function Time({ at, mode = "relative", className }: TimeProps): ReactNode {
  const visible = mode === "relative" ? formatRelative(at) : formatAbsolute(at);
  return (
    <time dateTime={at.toISOString()} title={formatAbsolute(at)} className={className}>
      {visible}
    </time>
  );
}
