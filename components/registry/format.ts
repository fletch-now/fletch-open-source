// How the authority's numbers read on a page. Pure functions over the stored
// strings; nothing here touches the chain or the database.

export function multiplierText(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${Number(value).toFixed(2)}×`;
}

export function priceText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const number = Number(value);
  return number >= 1000 ? `$${number.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${number.toFixed(2)}`;
}

// Raw token units to a readable count of tokens, e.g. 8510032000000000000000 → 8,510.03.
export function supplyText(raw: string | null | undefined, decimals: number): string {
  if (raw === null || raw === undefined) {
    return "—";
  }
  const whole = raw.length > decimals ? raw.slice(0, raw.length - decimals) : "0";
  const fraction = raw.padStart(decimals + 1, "0").slice(-decimals).slice(0, 2);
  return `${Number(whole).toLocaleString("en-US")}${decimals > 0 ? `.${fraction}` : ""}`;
}

export function percentText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number.toFixed(2)}%`;
}

// A share of a whole, unsigned. percentText carries a sign because it reads a
// change; a share of supply never does.
export function sharePctText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return `${Number(value).toFixed(2)}%`;
}

export function ago(date: Date | null | undefined): string {
  if (!date) {
    return "never";
  }
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 90) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${minutes} min ago`;
  }
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function feedReadingText(state: { feedAddress: string | null; feedPrice: string | null; feedCheckedAt: Date | null } | undefined): string {
  // A missing link does not establish whether a directory lookup or a first
  // answer failed. Only a saved feed check supplies an age for this reading.
  if (!state?.feedAddress) return "No feed linked";
  if (!state.feedCheckedAt) return "Feed not read";
  const label = state.feedPrice === null ? "Feed unavailable" : "Feed checked";
  return `${label} · ${ago(state.feedCheckedAt)}`;
}

export function dayText(date: Date | string | null | undefined): string {
  if (!date) {
    return "—";
  }
  const value = typeof date === "string" ? new Date(date) : date;
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function shortHex(value: string, head = 6, tail = 4): string {
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

// A block height for prose. Null is "?", the same as every other number the
// registry has not read yet.
export function blockText(value: bigint | null | undefined): string {
  return value === null || value === undefined ? "?" : value.toLocaleString("en-US");
}

// True when the timestamp is older than the window. Kept here, outside any
// component, so a render never reads the clock directly.
export function olderThan(at: Date | null, windowMs: number): boolean {
  return at === null || Date.now() - at.getTime() > windowMs;
}
