import type { ReactNode } from "react";
import type { DeliveryStatus, WatcherStatus } from "@/lib/watch/types";
import type { BuildStatus } from "@/lib/build/status";

export type StatusTone = "good" | "warn" | "bad" | "neutral" | "info";

export interface StatusChipProps {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}

const TONE_STYLE: Record<StatusTone, { bg: string; text: string; dot: string }> = {
  good: { bg: "bg-hood-wash", text: "text-hood-deep", dot: "bg-hood-deep" },
  warn: { bg: "bg-amber-50", text: "text-amber-800", dot: "bg-amber-600" },
  bad: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-600" },
  neutral: { bg: "bg-panel", text: "text-ink-soft", dot: "bg-ink-faint" },
  info: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-600" },
};

// Dot + word — never colour alone (WCAG 1.4.1). The word is the non-colour
// signal, so a caller must pass a real status word as children rather than
// reusing one word across two different tones.
export function StatusChip({ tone, children, className }: StatusChipProps): ReactNode {
  const style = TONE_STYLE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${style.bg} ${style.text} ${className ?? ""}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

// One mapping per domain enum, so a watcher's status renders the same tone
// everywhere it appears (list, detail page, admin table) rather than drifting
// per component. components/dashboard/watch/status-badge.tsx wraps this one.
export function watcherStatusTone(status: WatcherStatus): StatusTone {
  switch (status) {
    case "active":
      return "good";
    case "catching_up":
      return "warn";
    case "degraded":
      return "bad";
    case "paused":
      return "neutral";
    default:
      return "neutral";
  }
}

export function deliveryStatusTone(status: DeliveryStatus): StatusTone {
  switch (status) {
    case "sent":
      return "good";
    case "failed":
      return "bad";
    case "retracted":
      return "warn";
    case "pending":
      return "neutral";
    default:
      return "neutral";
  }
}

export function buildStatusTone(status: BuildStatus): StatusTone {
  switch (status) {
    case "succeeded":
      return "good";
    case "failed":
    case "killed":
      return "bad";
    case "queued":
      return "neutral";
    default:
      return "info";
  }
}
