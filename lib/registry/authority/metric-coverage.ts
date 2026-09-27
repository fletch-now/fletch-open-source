export interface MetricCoverage {
  eligible: number;
  current: number;
  failed: number;
  unread: number;
  oldestInputAgeSeconds: number | null;
  measuredAt: string;
}

export type MetricCoverageMap = Record<string, MetricCoverage>;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Run details survive partial failures. Invalid historical details cannot imply
// that a metric was measured or that an empty population was fully covered.
export function metricCoverageFromDetail(detail: unknown): MetricCoverageMap | null {
  if (!record(detail) || !record(detail.metricCoverage)) return null;
  const result: MetricCoverageMap = {};
  for (const [name, value] of Object.entries(detail.metricCoverage)) {
    if (!record(value)) continue;
    const { eligible, current, failed, unread, oldestInputAgeSeconds, measuredAt } = value;
    if (![eligible, current, failed, unread].every(count => typeof count === "number" && Number.isSafeInteger(count) && count >= 0)) continue;
    if (typeof measuredAt !== "string" || !Number.isFinite(Date.parse(measuredAt))) continue;
    if (oldestInputAgeSeconds !== null && (typeof oldestInputAgeSeconds !== "number" || !Number.isFinite(oldestInputAgeSeconds) || oldestInputAgeSeconds < 0)) continue;
    if (Number(current) > Number(eligible) || Number(failed) > Number(eligible) || Number(unread) > Number(eligible)) continue;
    result[name] = { eligible: Number(eligible), current: Number(current), failed: Number(failed), unread: Number(unread), oldestInputAgeSeconds, measuredAt };
  }
  return Object.keys(result).length ? result : null;
}
