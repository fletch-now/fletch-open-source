import Link from "@/components/ui/navigation-link";
import type { ReactNode } from "react";

export type StatTone = "neutral" | "good" | "warn" | "bad";

export interface StatDelta {
  // Signed; rendered as a percentage with an explicit sign, e.g. -12 -> "-12%".
  value: number;
  // The comparison basis — "vs last 7 days" — never omitted: a delta with no
  // stated baseline isn't actionable (Lazarev.agency dashboard UX guidance).
  label: string;
}

export interface StatProps {
  label: string;
  value: ReactNode;
  hint?: string;
  delta?: StatDelta;
  tone?: StatTone;
  href?: string;
}

export interface StatGridProps {
  children: ReactNode;
}

const TONE_VALUE_CLASS: Record<StatTone, string> = {
  neutral: "text-ink",
  good: "text-hood-deep",
  warn: "text-amber-700",
  bad: "text-red-700",
};

interface DeltaArrowProps {
  direction: "up" | "down";
}

function DeltaArrow({ direction }: DeltaArrowProps): ReactNode {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={direction === "down" ? "rotate-180" : undefined}
    >
      <path d="M5 1L9 8H1Z" fill="currentColor" />
    </svg>
  );
}

interface DeltaTagProps {
  delta: StatDelta;
}

function DeltaTag({ delta }: DeltaTagProps): ReactNode {
  if (delta.value === 0) {
    return <span className="inline-flex items-center gap-1 text-[12px] text-ink-faint">no change · {delta.label}</span>;
  }
  const positive = delta.value > 0;
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${positive ? "text-hood-deep" : "text-red-700"}`}>
      <DeltaArrow direction={positive ? "up" : "down"} />
      {positive ? "+" : ""}
      {delta.value}% {delta.label}
    </span>
  );
}

function StatBody({ label, value, hint, delta, tone = "neutral" }: StatProps): ReactNode {
  return (
    <>
      <p className="mono-label">{label}</p>
      <p className={`mt-2 text-[26px] font-semibold tabular-nums tracking-tight ${TONE_VALUE_CLASS[tone]}`}>{value}</p>
      {delta || hint ? (
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {delta ? <DeltaTag delta={delta} /> : null}
          {hint ? <span className="text-[12px] text-ink-faint">{hint}</span> : null}
        </div>
      ) : null}
    </>
  );
}

// A KPI tile: the big tabular figure carries the answer, the delta carries the
// direction and a stated comparison basis, `hint` carries anything else (a
// count breakdown, a caveat). `href` makes the whole tile a drill-down link —
// list view for scanning, detail view one click away (NNG, Data Tables).
export function Stat(props: StatProps): ReactNode {
  if (props.href) {
    return (
      <Link href={props.href} className="block bg-raised p-5 transition-colors hover:bg-panel/60">
        <StatBody {...props} />
      </Link>
    );
  }
  return (
    <div className="bg-raised p-5">
      <StatBody {...props} />
    </div>
  );
}

// A hairline-divided row of Stat tiles — the same grid every KPI row in this
// app already used, extracted. Three to five tiles; more than that belongs
// behind a click, not on the overview (NNG: cognitive load, not polish).
export function StatGrid({ children }: StatGridProps): ReactNode {
  return (
    <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      {children}
    </div>
  );
}
