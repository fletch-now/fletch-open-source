export interface LiveRegistryEvent {
  id: string;
  kind: string;
  title: string;
  symbol: string | null;
  address: string | null;
  observedAt: string;
  detail: Record<string, unknown>;
}

export type ActivityFilter = "auto" | "listing" | "alert" | "pool" | "all";
export type ActivityImportance = "alert" | "listing" | "change" | "routine";
export interface ActivityGroup {
  event: LiveRegistryEvent;
  members: LiveRegistryEvent[];
  importance: ActivityImportance;
}

export function activityImportance(kind: string): ActivityImportance {
  if (/\.(paused|halted|noncanonical|blocked|degraded|stale|residual)$/.test(kind)) return "alert";
  if (kind.startsWith("listing.")) return "listing";
  if (kind === "dex.pool_new" || kind.startsWith("bridge.") || kind === "dex.premium") return "routine";
  return "change";
}

export function parseActivityEvent(value: unknown): LiveRegistryEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.title !== "string" || typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) return null;
  return { id: row.id, kind: row.kind, title: row.title, observedAt: row.observedAt,
    symbol: typeof row.symbol === "string" ? row.symbol : null, address: typeof row.address === "string" ? row.address : null,
    detail: row.detail && typeof row.detail === "object" ? row.detail as Record<string, unknown> : {} };
}

function newestFirst(a: LiveRegistryEvent, b: LiveRegistryEvent): number {
  return Date.parse(b.observedAt) - Date.parse(a.observedAt) || b.id.localeCompare(a.id);
}

export function mergeActivity(current: LiveRegistryEvent[], incoming: LiveRegistryEvent[]): LiveRegistryEvent[] {
  const unique = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) unique.set(event.id, event);
  const sorted = [...unique.values()].sort(newestFirst);
  // Retain room for singular signals even during a large factory burst.
  const signals = sorted.filter((event) => activityImportance(event.kind) !== "routine").slice(0, 100);
  const recent = sorted.slice(0, 400);
  return [...new Map([...recent, ...signals].map((event) => [event.id, event])).values()].sort(newestFirst);
}

export function activityGroups(events: LiveRegistryEvent[], filter: ActivityFilter, query: string): ActivityGroup[] {
  const needle = query.trim().toUpperCase();
  const groups: ActivityGroup[] = [];
  const bursts = new Map<string, ActivityGroup>();
  for (const event of [...events].sort(newestFirst)) {
    if (needle && !`${event.symbol ?? ""} ${event.title}`.toUpperCase().includes(needle)) continue;
    const importance = activityImportance(event.kind);
    if (filter === "auto" && importance === "routine") continue;
    if (filter === "listing" && importance !== "listing") continue;
    if (filter === "alert" && importance !== "alert") continue;
    if (filter === "pool" && event.kind !== "dex.pool_new") continue;
    const tokenSubject = typeof event.detail.tokenAddress === "string" ? event.detail.tokenAddress : event.symbol ?? event.address ?? event.id;
    const subject = typeof event.detail.assetId === "string" ? event.detail.assetId : tokenSubject;
    const burst = event.kind === "dex.pool_new" ? bursts.get(subject) : undefined;
    if (burst && Date.parse(burst.event.observedAt) - Date.parse(event.observedAt) <= 30 * 60_000) {
      burst.members.push(event);
      continue;
    }
    const group = { event, members: [event], importance };
    groups.push(group);
    if (event.kind === "dex.pool_new") bursts.set(subject, group);
  }
  if (filter === "auto") {
    const rank = { alert: 0, listing: 1, change: 2, routine: 3 };
    groups.sort((a, b) => rank[a.importance] - rank[b.importance] || newestFirst(a.event, b.event));
  }
  return groups;
}
