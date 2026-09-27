import type { ReactNode } from "react";

export interface PanelProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}

// A titled section with a rule under the header — not a card inside a card.
// Only the outermost container of a page (or a Table/EmptyState) gets its own
// border + bg-raised; content placed inside a Panel should not repeat either.
export function Panel({ title, description, actions, children }: PanelProps): ReactNode {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-[14px] font-medium text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-[12.5px] text-ink-soft">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
