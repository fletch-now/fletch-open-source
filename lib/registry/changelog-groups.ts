import type { AuthorityEvent } from "./authority/read";

export interface ChangelogGroup {
  event: AuthorityEvent;
  members: AuthorityEvent[];
}

export function groupChangelog(events: AuthorityEvent[]): ChangelogGroup[] {
  const groups: ChangelogGroup[] = [];
  const bursts = new Map<string, ChangelogGroup>();
  for (const event of [...events].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime() || b.id.localeCompare(a.id))) {
    const detail = event.detail && typeof event.detail === "object" ? event.detail as Record<string, unknown> : {};
    const subject = event.assetId ?? (typeof detail.tokenAddress === "string" ? detail.tokenAddress : event.symbol) ?? event.address;
    const key = `${event.chainId}:${subject}`;
    const group = event.kind === "dex.pool_new" && subject ? bursts.get(key) : undefined;
    if (group && group.event.observedAt.getTime() - event.observedAt.getTime() <= 30 * 60_000) {
      group.members.push(event);
    } else {
      const next = { event, members: [event] };
      groups.push(next);
      if (event.kind === "dex.pool_new" && subject) bursts.set(key, next);
    }
  }
  return groups;
}
