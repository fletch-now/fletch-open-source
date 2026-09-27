export const TOKEN_REFRESH_MS = 24 * 60 * 60_000;
export const TOKEN_RETRY_MS = 60 * 60_000;
export const TOKEN_READ_BATCH = 40;
export const TOKEN_GROUP = 4;
// Discovery selection is independent of the number of tokens per RPC group.
export const IMMEDIATE_TOKEN_PROBE_LIMIT = 25;
export const TOKEN_WORK_MS = 45_000;

export interface TokenReadState {
  checkedAt: Date | null;
  error: string | null;
}

export interface TokenMetadataBacklog {
  total: number;
  due: number;
  visibleDue: number;
  neverRead: number;
  errors: number;
  oldestCheckedAt: string | null;
  measuredAt: string;
}

export function tokenReadDue(row: TokenReadState | undefined, now: Date): boolean {
  if (!row?.checkedAt) return true;
  const age = now.getTime() - row.checkedAt.getTime();
  return !Number.isFinite(age) || age < 0 || age >= (row.error === null ? TOKEN_REFRESH_MS : TOKEN_RETRY_MS);
}

export function metadataBacklog(addresses: readonly string[], known: ReadonlyMap<string, TokenReadState>, visible: ReadonlySet<string>, now: Date): TokenMetadataBacklog {
  let due = 0;
  let visibleDue = 0;
  let neverRead = 0;
  let errors = 0;
  let oldest: Date | null = null;
  for (const address of addresses) {
    const row = known.get(address);
    if (!row?.checkedAt) neverRead++;
    if (row?.error) errors++;
    if (row?.checkedAt && Number.isFinite(row.checkedAt.getTime()) && (!oldest || row.checkedAt < oldest)) oldest = row.checkedAt;
    if (!tokenReadDue(row, now)) continue;
    due++;
    if (visible.has(address)) visibleDue++;
  }
  return { total: addresses.length, due, visibleDue, neverRead, errors, oldestCheckedAt: oldest?.toISOString() ?? null, measuredAt: now.toISOString() };
}

// Reserve three reads for active tokens by their deepest pool and one for the
// oldest backlog. Rotate that slot each minute so a short work deadline cannot
// keep ending before the oldest lane gets its first request.
export function tokenFairPosition(now: Date): number {
  return (3 - Math.floor(now.getTime() / 60_000) % 4 + 4) % 4;
}

export function selectTokenReads(addresses: readonly string[], known: ReadonlyMap<string, TokenReadState>, visible: ReadonlySet<string>, now: Date, limit: number, depths: ReadonlyMap<string, number> = new Map()): string[] {
  const due = [...new Set(addresses)].filter((address) => tokenReadDue(known.get(address), now));
  due.sort(function oldestFirst(a, b) {
    const age = (known.get(a)?.checkedAt?.getTime() || 0) - (known.get(b)?.checkedAt?.getTime() || 0);
    return age || a.localeCompare(b);
  });
  const preferred = due.filter((address) => visible.has(address)).sort((a, b) =>
    (depths.get(b) ?? 0) - (depths.get(a) ?? 0));
  const selected = new Set<string>();
  let oldestIndex = 0;
  let preferredIndex = 0;
  while (selected.size < limit && selected.size < due.length) {
    while (oldestIndex < due.length && selected.has(due[oldestIndex])) oldestIndex++;
    while (preferredIndex < preferred.length && selected.has(preferred[preferredIndex])) preferredIndex++;
    const usePreferred = selected.size % 4 !== tokenFairPosition(now) && preferredIndex < preferred.length;
    const next = usePreferred ? preferred[preferredIndex++] : due[oldestIndex++];
    if (next === undefined) break;
    selected.add(next);
  }
  return [...selected];
}

export function metadataBacklogFromDetail(detail: unknown): TokenMetadataBacklog | null {
  if (!detail || typeof detail !== "object" || !("metadataBacklog" in detail)) return null;
  const value = detail.metadataBacklog;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  for (const key of ["total", "due", "visibleDue", "neverRead", "errors"]) {
    if (typeof row[key] !== "number" || !Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return null;
  }
  if (typeof row.measuredAt !== "string" || !Number.isFinite(Date.parse(row.measuredAt))) return null;
  if (row.oldestCheckedAt !== null && (typeof row.oldestCheckedAt !== "string" || !Number.isFinite(Date.parse(row.oldestCheckedAt)))) return null;
  return value as TokenMetadataBacklog;
}
