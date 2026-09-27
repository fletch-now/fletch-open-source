import { WalletButton } from "@/components/wallet-button";
import Link from "@/components/ui/navigation-link";
import type { ReactNode } from "react";
import { ChevronRight } from "@/components/ui/icons";

export interface Breadcrumb {
  href: string;
  label: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  breadcrumb?: Breadcrumb[];
}

// The one header every dashboard/admin page opens with. Title sits top-left —
// the F-pattern's heaviest fixation (NNG eye-tracking) — with actions top-right;
// a detail page one level below a list adds a breadcrumb trail above both.
export function PageHeader({ title, description, actions, breadcrumb }: PageHeaderProps): ReactNode {
  return (
    <div className="mb-6">
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-faint">
          {breadcrumb.map(function renderCrumb(crumb, index) {
            return (
              <span key={crumb.href} className="flex items-center gap-1">
                {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0" strokeWidth={1.8} /> : null}
                <Link href={crumb.href} className="underline-offset-4 hover:text-ink hover:underline">
                  {crumb.label}
                </Link>
              </span>
            );
          })}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display truncate text-[26px] text-ink">{title}</h1>
          {description ? <p className="mt-1 text-[14px] text-ink-soft">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {/* The phone header already has one; this is the desktop's. */}
          <span className="hidden sm:flex">
            <WalletButton tone="light" />
          </span>
        </div>
      </div>
    </div>
  );
}
