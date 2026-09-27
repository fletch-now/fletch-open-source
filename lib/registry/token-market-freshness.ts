import type { Metric, MetricInput, TokenMarket } from "./token-markets-types";
import { observationStatus } from "./metric-observation";

const METRICS = ["decimals", "totalSupplyRaw", "burnedRaw", "priceUsd", "marketCapUsd", "volumeUsd24h", "swaps24h", "transactions24h", "holders", "v3QuoteHoldingsUsd", "v4OnePercentDepthUsd"] as const;

// A response can await identity or pool details after constructing its readings.
// Expiration removes values without changing the recorded source or read times.
export function revalidateMetric<T extends Metric<unknown> | MetricInput>(metric: T, now: number): T {
  const inputs = metric.observation.inputs.map((input) => revalidateMetric(input, now));
  let status = metric.observation.status;
  if (status === "current") {
    status = observationStatus(metric.asOf, metric.observation.expiresAt, now);
    if (inputs.some((input) => input.observation.status === "stale")) status = "stale";
  }
  const changed = status !== metric.observation.status;
  return { ...metric, value: status === "current" ? metric.value : null,
    ...("reason" in metric && changed ? { reason: metric.reason ?? "The observation expired before this response was constructed." } : {}),
    observation: { ...metric.observation, status, inputs } };
}

export function revalidateTokenMarket(reading: TokenMarket, now = Date.now()): TokenMarket {
  const result = { ...reading };
  for (const key of METRICS) {
    // Numeric and raw-integer metrics share the same expiration projection.
    Object.assign(result, { [key]: revalidateMetric(reading[key], now) });
  }
  const status = reading.selection.status === "current"
    ? observationStatus(reading.selection.selectedAt, reading.selection.expiresAt, now) : reading.selection.status;
  result.selection = { ...reading.selection, status };
  result.dominantAddress = status === "current" ? reading.dominantAddress : null;
  return result;
}
