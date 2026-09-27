import type { SwapIndexerReading } from "@/lib/registry/authority/market-swap-status";

export function indexedBlockText(value: string | null): string {
  if (value === null || !/^\d+$/.test(value)) return "—";
  return BigInt(value).toLocaleString("en-US");
}

export function indexedTimeText(value: string | null): string {
  if (value === null) return "—";
  const time = new Date(value);
  if (!Number.isFinite(time.getTime())) return "—";
  return `${time.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

export function indexedAgeText(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  if (whole < 60) return `${whole} s`;
  if (whole < 3600) return `${Math.floor(whole / 60)} min ${whole % 60} s`;
  return `${Math.floor(whole / 3600)} h ${Math.floor((whole % 3600) / 60)} min`;
}

export function swapWindowText(start: string | null, end: string | null): string {
  if (start === null || end === null) return "—";
  const first = indexedTimeText(start);
  const last = indexedTimeText(end);
  if (first === "—" || last === "—" || Date.parse(start) >= Date.parse(end)) return "—";
  return `${first} to ${last}`;
}

export function swapCoverageNote(reading: SwapIndexerReading): string {
  if (indexedTimeText(reading.newestCountedAt) === "—") return "No counted swap window yet.";
  if (!reading.current) return "The counted window is not current; figures remain unavailable.";
  if (reading.priorityPoolCount !== undefined) {
    return `${(reading.priorityComplete24hPools ?? 0).toLocaleString("en-US")} of ${reading.priorityPoolCount.toLocaleString("en-US")} selected priority pools have a complete 24-hour window; ${(reading.priorityValued24hPools ?? 0).toLocaleString("en-US")} have supported quote valuations.`;
  }
  const complete = reading.tiers.reduce((sum, tier) => sum + tier.complete24hPools, 0);
  const total = reading.tiers.reduce((sum, tier) => sum + tier.totalPools, 0);
  return `${complete.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} pools have a complete 24-hour window.`;
}
