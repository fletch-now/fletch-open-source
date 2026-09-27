import type { WatcherRow } from "@/lib/watch/queries";
import { StatusChip, watcherStatusTone } from "@/components/dashboard/ui/status-chip";

// One source of truth for what each watcher status means, shared by the list
// (watcher-list.tsx) and the detail page (watch/[id]/page.tsx) so the wording
// never drifts between the two. Tone lives in components/dashboard/ui/status-chip
// (watcherStatusTone) so every place a watcher status renders — this badge, an
// admin table row — uses the same colour for the same word.
export const WATCHER_STATUS_META: Record<WatcherRow["status"], { label: string; meaning: string }> = {
  active: {
    label: "active",
    meaning: "Enabled. Matching events are saved in your dashboard.",
  },
  catching_up: {
    label: "catching up",
    meaning: "Scanning past blocks before it starts alerting on new ones.",
  },
  degraded: {
    label: "degraded",
    meaning: "Source reads are delayed or failing. Matches may be late or missed.",
  },
  paused: {
    label: "paused",
    meaning: "Not watching. Resume to pick back up where it left off.",
  },
};

interface StatusBadgeProps {
  status: WatcherRow["status"];
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps): React.ReactNode {
  const meta = WATCHER_STATUS_META[status];
  return (
    <StatusChip tone={watcherStatusTone(status)} className={className}>
      {meta.label}
    </StatusChip>
  );
}

export function statusMeaning(status: WatcherRow["status"]): string {
  return WATCHER_STATUS_META[status].meaning;
}
