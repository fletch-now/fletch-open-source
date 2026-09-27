// Small formatters shared by the admin pages. Kept here, not in the kit, because
// the kit is user-facing and these are operator-facing (raw ids, bytes, seconds).

export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return "—";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export function percent(part: number, whole: number): string {
  if (whole === 0) {
    return "—";
  }
  return `${Math.round((part / whole) * 100)}%`;
}

// Age helpers live here rather than in a page body: React's purity lint flags a
// Date.now() call during render, and the age is derived data anyway.
export function ageSeconds(at: Date | null): number | null {
  if (!at) {
    return null;
  }
  return Math.round((Date.now() - at.getTime()) / 1000);
}

export function ageMinutes(at: Date | null): number | null {
  const seconds = ageSeconds(at);
  return seconds === null ? null : Math.round(seconds / 60);
}

// "42s", "18m", "16h", "3d": a heartbeat or sync age at a glance.
export function formatAge(seconds: number | null): string {
  if (seconds === null) {
    return "never";
  }
  if (seconds < 90) {
    return `${seconds}s`;
  }
  if (seconds < 5400) {
    return `${Math.round(seconds / 60)}m`;
  }
  if (seconds < 172_800) {
    return `${Math.round(seconds / 3600)}h`;
  }
  return `${Math.round(seconds / 86_400)}d`;
}
