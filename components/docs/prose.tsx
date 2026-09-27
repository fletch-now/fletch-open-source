import type { ReactElement, ReactNode } from "react";

// The three shapes every docs page uses. Kept here so a new page cannot invent
// a fourth heading size or a second code-block style.

export function DocsTitle({ children, lede, embedded = false }: { children: ReactNode; lede: string; embedded?: boolean }): ReactElement {
  const Heading = embedded ? "h2" : "h1";
  return (
    <header className="mb-8">
      <Heading className="display text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.05] text-ink">{children}</Heading>
      <p className="mt-3 max-w-2xl text-[15px] leading-7 text-ink-soft">{lede}</p>
    </header>
  );
}

export function DocsSection({ title, children, embedded = false }: { title: string; children: ReactNode; embedded?: boolean }): ReactElement {
  const Heading = embedded ? "h3" : "h2";
  return (
    <section className="mb-10">
      <Heading className="mb-3 text-[13px] font-medium uppercase tracking-[0.12em] text-ink-faint">{title}</Heading>
      <div className="flex flex-col gap-3 text-[14.5px] leading-7 text-ink-soft">{children}</div>
    </section>
  );
}

export function Snippet({ children }: { children: string }): ReactElement {
  return (
    <pre className="overflow-x-auto rounded-card border border-line bg-panel/60 px-4 py-3 font-mono text-[12.5px] leading-6 text-ink">
      {children}
    </pre>
  );
}
