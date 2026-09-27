import type { ReactNode } from "react";
import { Reveal } from "@/components/landing/reveal";

// The reference's shared section devices, extracted once because it repeats them
// identically across every section: a hairline-and-mono eyebrow, an oversized
// two-tone display headline, and a big-figure/small-caption stat unit.

interface EyebrowProps {
  children: ReactNode;
  /** Hairline on both sides, for sections with a centred header. */
  centered?: boolean;
  /** Dark bands need a lighter rule and label than the paper sections. */
  onDark?: boolean;
  className?: string;
}

export function Eyebrow({ children, centered = false, onDark = false, className = "" }: EyebrowProps) {
  const rule = onDark ? "bg-white/25" : "bg-ink/25";
  const label = onDark ? "text-white/[0.62]" : "text-ink-faint";
  return (
    <span
      className={`inline-flex items-center gap-3 font-mono text-[12.5px] tracking-[0.02em] ${label} ${className}`}
    >
      <span aria-hidden="true" className={`h-px w-12 ${rule}`} />
      {children}
      {centered ? <span aria-hidden="true" className={`h-px w-12 ${rule}`} /> : null}
    </span>
  );
}

interface DisplayHeadingProps {
  /** Rendered at full ink. */
  lead: string;
  /** Rendered muted, on its own line — the reference's two-tone split. */
  trail?: string;
  /** Draws the trailing line as outline type instead of muted fill. */
  outlineTrail?: boolean;
  onDark?: boolean;
  centered?: boolean;
  className?: string;
}

export function DisplayHeading({
  lead,
  trail,
  outlineTrail = false,
  onDark = false,
  centered = false,
  className = "",
}: DisplayHeadingProps) {
  const leadTone = onDark ? "text-white" : "text-ink";
  const trailTone = onDark ? "text-white/55" : "text-ink-faint";
  return (
    <h2
      className={`display text-balance text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.95] tracking-[-0.02em] ${leadTone} ${
        centered ? "text-center" : ""
      } ${className}`}
    >
      {lead}
      {trail ? (
        <span className={`block ${outlineTrail ? "outline-type" : trailTone}`}>{trail}</span>
      ) : null}
    </h2>
  );
}

interface StatProps {
  value: string;
  label: string;
  onDark?: boolean;
}

// A large display figure with a small mono caption — the reference's stat idiom,
// repeated in four of its sections.
export function Stat({ value, label, onDark = false }: StatProps) {
  return (
    <div>
      <p
        className={`display text-[clamp(2.2rem,4.4vw,3.4rem)] leading-none tabular-nums ${
          onDark ? "text-white" : "text-ink"
        }`}
      >
        {value}
      </p>
      <p
        className={`mt-2.5 font-mono text-[11.5px] leading-5 ${
          onDark ? "text-white/[0.62]" : "text-ink-faint"
        }`}
      >
        {label}
      </p>
    </div>
  );
}

interface SectionHeaderProps {
  eyebrow: string;
  lead: string;
  trail?: string;
  outlineTrail?: boolean;
  deck?: ReactNode;
  /** Fills the right column instead of the deck; the deck then sits under the headline. */
  aside?: ReactNode;
  onDark?: boolean;
  centered?: boolean;
}

// The reference's 7/5 header: giant headline left, small deck right, baselines
// aligned by a nudge on the deck column. Centred variant stacks instead.
export function SectionHeader({
  eyebrow,
  lead,
  trail,
  outlineTrail,
  deck,
  aside,
  onDark = false,
  centered = false,
}: SectionHeaderProps) {
  if (centered) {
    return (
      <Reveal className="mb-10 flex flex-col items-center text-center lg:mb-14">
        <Eyebrow centered onDark={onDark} className="mb-7">
          {eyebrow}
        </Eyebrow>
        <DisplayHeading lead={lead} trail={trail} outlineTrail={outlineTrail} onDark={onDark} centered />
        {deck ? (
          <div
            className={`mt-7 max-w-xl text-[16px] leading-8 ${onDark ? "text-white/70" : "text-ink-soft"}`}
          >
            {deck}
          </div>
        ) : null}
      </Reveal>
    );
  }

  if (aside) {
    return (
      <Reveal className="mb-10 lg:mb-14">
        <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
          <div className="lg:col-span-7">
            <Eyebrow onDark={onDark} className="mb-7">
              {eyebrow}
            </Eyebrow>
            <DisplayHeading lead={lead} trail={trail} outlineTrail={outlineTrail} onDark={onDark} />
            {deck ? (
              <div className={`mt-7 max-w-xl text-[16px] leading-8 ${onDark ? "text-white/70" : "text-ink-soft"}`}>
                {deck}
              </div>
            ) : null}
          </div>
          <div className="min-w-0 lg:col-span-5">{aside}</div>
        </div>
      </Reveal>
    );
  }

  return (
    <Reveal className="mb-10 lg:mb-14">
      <div className="grid items-end gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <Eyebrow onDark={onDark} className="mb-7">
            {eyebrow}
          </Eyebrow>
          <DisplayHeading lead={lead} trail={trail} outlineTrail={outlineTrail} onDark={onDark} />
        </div>
        {deck ? (
          <div
            className={`lg:col-span-5 lg:pb-4 ${onDark ? "text-white/70" : "text-ink-soft"} text-[16px] leading-8`}
          >
            {deck}
          </div>
        ) : null}
      </div>
    </Reveal>
  );
}
