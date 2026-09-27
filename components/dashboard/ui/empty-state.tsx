import Link from "@/components/ui/navigation-link";
import type { ReactNode } from "react";

export interface EmptyStateAction {
  href: string;
  label: string;
}

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: EmptyStateAction;
}

// Blank containers are ambiguous — loading, filtered-to-zero, and broken all
// look identical without copy (NNG, Designing Empty States). `title`/`body`
// are the page's job to make specific ("No alerts match this filter" vs. "No
// alerts have fired yet" vs. a load failure); this component just gives every
// one of those states the same shape, with one next action, never zero.
export function EmptyState({ title, body, action }: EmptyStateProps): ReactNode {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-dashed border-line bg-panel/40 px-6 py-10 text-left">
      <div>
        <p className="text-[14.5px] font-medium text-ink">{title}</p>
        <p className="mt-1 text-[13.5px] text-ink-soft">{body}</p>
      </div>
      {action ? (
        <Link
          href={action.href}
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
