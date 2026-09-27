export interface BuildDurationEstimate {
  lowerMinutes: number;
  upperMinutes: number;
  sampleSize: number;
  observedAt: string;
}

export interface BuildTiming {
  estimate: BuildDurationEstimate | null;
  startedAt: string | null;
  serverNow: string;
}

// Whole-minute quantiles keep the precision appropriate to a historical estimate.
// Long successful builds stay in the sample; this is never a runtime limit.
export function estimateBuildDuration(durationsMs: number[], now = new Date()): BuildDurationEstimate | null {
  const sorted = durationsMs.filter(function valid(value) {
    return Number.isFinite(value) && value > 0;
  }).sort(function ascending(a, b) { return a - b; });
  if (sorted.length < 5) return null;
  const lower = sorted[Math.floor((sorted.length - 1) * 0.2)]!;
  const upper = sorted[Math.ceil((sorted.length - 1) * 0.8)]!;
  return {
    lowerMinutes: Math.max(1, Math.floor(lower / 60_000)),
    upperMinutes: Math.max(1, Math.ceil(upper / 60_000)),
    sampleSize: sorted.length,
    observedAt: now.toISOString(),
  };
}

export function durationRange(estimate: BuildDurationEstimate): string {
  if (estimate.lowerMinutes === estimate.upperMinutes) return `${estimate.upperMinutes} min`;
  return `${estimate.lowerMinutes}–${estimate.upperMinutes} min`;
}

export function elapsedBuildMinutes(startedAt: string | null, now: number): number | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started) || !Number.isFinite(now)) return null;
  return Math.max(0, Math.floor((now - started) / 60_000));
}
