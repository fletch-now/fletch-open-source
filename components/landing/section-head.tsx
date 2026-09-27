import type { ReactNode } from "react";
import { Reveal } from "@/components/landing/reveal";

// The reference's section opening, in our key: a mono status pill with a live dot,
// then an oversized display heading whose trailing clause drops to a quieter ink so
// the line reads as one sentence with emphasis rather than as a shouted banner.

interface SectionHeadProps {
  eyebrow: string;
  title: string;
  // Rendered in muted ink on its own line — the reference's two-tone headline.
  trail?: string;
  meta?: string;
  children?: ReactNode;
}

export function SectionHead({ eyebrow, title, trail, meta, children }: SectionHeadProps) {
  return (
    <Reveal className="mb-14 lg:mb-20">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-hood-wash px-3 py-1 font-mono text-[11px] uppercase tracking-[0.08em] text-hood-deep ring-1 ring-inset ring-hood/25">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hood opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-hood" />
          </span>
          {eyebrow}
        </span>
        {meta ? <span className="font-mono text-[12px] text-ink-faint">{meta}</span> : null}
      </div>
      <h2 className="display max-w-4xl text-balance text-[clamp(2.1rem,5.2vw,4rem)] leading-[0.98] text-ink">
        {title}
        {trail ? <span className="block text-ink-faint">{trail}</span> : null}
      </h2>
      {children ? <div className="mt-6 max-w-xl text-[15px] leading-7 text-ink-soft">{children}</div> : null}
    </Reveal>
  );
}
