import type { JobName } from "./cadence";

// The live swap window expires after 120 seconds. Waiting a whole cadence
// after its RPC reads finish would add their duration to every following tick.
export function successfulRegistryJobDelay(name: JobName, cadenceMs: number, elapsedMs: number): number {
  if (["app-catalog", "explorer-scouting", "priority-holders", "priority-universe", "dex-pools", "dex-pools-v3", "dex-swaps", "dex-state", "priority-supply", "dex-token-discovery"].includes(name)) return Math.max(5_000, cadenceMs - elapsedMs);
  return cadenceMs;
}

// Shortening successful swap cadence must not accelerate retries after an
// outage. Other jobs keep the existing one-minute exponential retry policy.
export function failedRegistryJobDelay(name: JobName, cadenceMs: number, streak: number): number {
  if (name === "app-catalog") return Math.min(300_000, 15_000 * 2 ** Math.min(streak - 1, 5));
  if (name === "dex-swaps") return 60_000;
  return Math.min(cadenceMs, 60_000 * 2 ** Math.min(streak - 1, 5));
}

// Startup order follows freshness requirements, so adding an hourly job cannot
// postpone a minute job beyond its first freshness window after every deploy.
export function registryStartupDelays(cadences: Readonly<Record<string, number>>): Map<string, number> {
  const ordered = Object.entries(cadences).sort(function byUrgency([left, leftCadence], [right, rightCadence]): number {
    if (left === "dex-swaps") return -1;
    if (right === "dex-swaps") return 1;
    return leftCadence - rightCadence;
  });
  const delays = new Map<string, number>();
  let delayMs = 0;
  for (const [name, cadenceMs] of ordered) {
    if (name !== "dex-swaps") delayMs += cadenceMs <= 60_000 ? 1_500 : 5_000;
    delays.set(name, delayMs);
  }
  return delays;
}
