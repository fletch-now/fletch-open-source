import Link from "@/components/ui/navigation-link";
import type { TrustLevel } from "@/lib/registry/trust-rules";

// The one badge for what a token is. Every surface renders this from
// lib/registry/trust.ts's verdict; no page decides its own wording or colour,
// so a token cannot read as community here and verified there.

const TONE: Record<TrustLevel, string> = {
  verified: "bg-hood-wash text-hood-deep ring-hood/30",
  listed: "bg-panel text-ink ring-line",
  lookalike: "bg-red-50 text-red-700 ring-red-200",
  community: "bg-amber-50 text-amber-800 ring-amber-200",
  unknown: "bg-panel text-ink ring-line",
};

interface TrustBadgeProps {
  level: TrustLevel;
  // The sentence behind the badge, from the same verdict.
  detail?: string;
  className?: string;
}

export function TrustBadge({ level, detail, className = "" }: TrustBadgeProps) {
  return (
    <Link
      href={`/docs/trust#${level}`}
      aria-label={`${level}: read the trust definition`}
      title={detail}
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium capitalize ring-1 ring-inset ${TONE[level]} underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood ${className}`}
    >
      {level}
    </Link>
  );
}
