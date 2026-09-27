import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";

interface SortHeadingProps {
  label: string;
  href: string;
  active: boolean;
  order: "asc" | "desc";
  nextOrder: "asc" | "desc";
}

export function SortHeading({ label, href, active, order, nextOrder }: SortHeadingProps): ReactElement {
  const next = nextOrder === "asc" ? "ascending" : "descending";
  return <Link href={href} scroll={false} prefetch={false}
    aria-label={`Sort by ${label.toLowerCase()}, ${next}`}
    className={`inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${active ? "text-ink" : "text-ink-soft hover:text-ink"}`}>
    {label}<svg aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5 shrink-0">
      {active ? <path d={order === "asc" ? "M8 13V3m-4 4 4-4 4 4" : "M8 3v10m-4-4 4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" /> : <><path d="M5 12V3L2 6m3-3 3 3M11 4v9l3-3m-3 3-3-3" strokeLinecap="round" strokeLinejoin="round" /></>}
    </svg>
  </Link>;
}
