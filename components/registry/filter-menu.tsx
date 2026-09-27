"use client";

import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { ControlPopover, PopoverChevron, POPOVER_ITEM_CLASS } from "@/components/chat/control-popover";

export interface FilterOption {
  label: string;
  href: string;
  active: boolean;
  count?: number;
  description?: string;
}

interface FilterMenuProps {
  label: string;
  value: string;
  options: FilterOption[];
}

export function FilterMenu({ label, value, options }: FilterMenuProps): ReactElement {
  return <>
    <ControlPopover label={`${label}: ${value}`} className="h-11 max-w-full gap-1.5 px-2.5 text-[12px] sm:gap-2 sm:px-3 sm:text-[14px]" trigger={<><span>{label}:</span>{" "}<span className="truncate font-medium">{value}</span><PopoverChevron /></>}>
      {function choices(close) {
        return options.map(function option(item) {
          return <Link key={item.href} href={item.href} scroll={false} prefetch={false} onClick={close} role="menuitemradio" aria-checked={item.active} data-popover-item tabIndex={-1} className={`${POPOVER_ITEM_CLASS} !text-[14px]`}>
            <span className="w-4 shrink-0" aria-hidden="true">{item.active ? "✓" : ""}</span>
            <span className="min-w-0 flex-1"><span className="block">{item.label}</span>{item.description ? <span className="mt-1 block text-[12px] leading-5">{item.description}</span> : null}</span>
            {item.count !== undefined ? <span className="tabular-nums">{item.count.toLocaleString("en-US")}</span> : null}
          </Link>;
        });
      }}
    </ControlPopover>
    <noscript><details className="rounded-lg border border-line bg-white p-3 text-[14px]"><summary>{label}: {value}</summary><ul className="mt-2 space-y-2">{options.map(function fallback(item) {
      return <li key={item.href}><a href={item.href} aria-current={item.active ? "true" : undefined} className="underline underline-offset-4">{item.label}{item.count !== undefined ? ` (${item.count.toLocaleString("en-US")})` : ""}</a></li>;
    })}</ul></details></noscript>
  </>;
}
