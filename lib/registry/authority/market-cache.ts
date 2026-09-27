interface TimedPool {
  stateCheckedAt: Date | null;
  metricsAsOf?: Date | null;
}

// A cached response expires before its oldest published observation does.
// Missing/stale fields are already suppressed by the public formatter.
export function marketCacheSeconds(pools: readonly TimedPool[], now = Date.now(), maximum = 30): number {
  let remaining = maximum * 1000;
  for (const pool of pools) {
    for (const [at, window] of [[pool.stateCheckedAt, 600_000], [pool.metricsAsOf, 120_000]] as const) {
      if (!at) continue;
      const age = now - at.getTime();
      if (age >= 0 && age <= window) remaining = Math.min(remaining, window - age);
    }
  }
  return Math.max(0, Math.floor(remaining / 1000));
}
