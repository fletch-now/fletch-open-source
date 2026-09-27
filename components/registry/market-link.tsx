"use client";

import type { ReactNode } from "react";
import Link from "@/components/ui/navigation-link";
import { useLinkStatus } from "next/link";

interface Props {
  href: string;
  children: ReactNode;
  className?: string;
  title?: string;
  active?: boolean;
}

function Pending(): ReactNode {
  const { pending } = useLinkStatus();
  return <span role="status" className="inline-flex w-4 shrink-0 justify-center">
    <span aria-hidden className={`h-3 w-3 rounded-full border-2 border-current border-r-transparent ${pending ? "motion-safe:animate-spin" : "invisible"}`} />
    <span className="sr-only">{pending ? "Updating markets" : ""}</span>
  </span>;
}

export function MarketLink({ href, children, className, title, active }: Props): ReactNode {
  return <Link href={href} scroll={false} prefetch={false} title={title} aria-current={active ? "true" : undefined} className={`inline-flex items-center gap-1 ${className ?? ""}`}>
    {children}<Pending />
  </Link>;
}
