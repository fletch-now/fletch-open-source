"use client";

import { useState, type ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { usePathname } from "next/navigation";

export interface DocsSearchEntry {
  href: string;
  title: string;
  description: string;
  text: string;
  supplemental: boolean;
}

export function DocsSidebar({
  entries,
}: {
  entries: readonly DocsSearchEntry[];
}): ReactElement {
  const pathname = usePathname();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = entries.filter((entry) =>
    terms.every((term) => entry.text.includes(term)),
  );
  return (
    <nav
      aria-label="Documentation"
      className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto"
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="docs-contents"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-md border border-line px-3 py-3 text-[13px] text-ink focus-visible:outline-2 focus-visible:outline-hood lg:hidden"
      >
        Contents and search{" "}
        <span aria-hidden="true">{expanded ? "−" : "+"}</span>
      </button>
      <div
        id="docs-contents"
        className={`${expanded ? "block" : "hidden"} pt-4 lg:block lg:pt-0`}
      >
        <label className="mb-4 block text-[12px] text-ink-soft">
          Search documentation
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Wallet, credits, API…"
            className="mt-2 w-full rounded-md border border-line bg-raised px-3 py-2 text-[13px] text-ink outline-none focus-visible:border-hood"
          />
        </label>
        {terms.length > 0 ? (
          <p role="status" className="mb-3 text-[12px] text-ink-faint">
            {matches.length} {matches.length === 1 ? "page" : "pages"} found
          </p>
        ) : null}
        <ul className="space-y-1">
          {matches.map(function entry(entry) {
            const active = pathname === entry.href;
            return (
              <li
                key={entry.href}
                className={
                  entry.supplemental && terms.length === 0
                    ? "border-t border-line pt-2"
                    : undefined
                }
              >
                <Link
                  href={entry.href}
                  prefetch={false}
                  onClick={() => setExpanded(false)}
                  aria-current={active ? "page" : undefined}
                  className={`block rounded-md px-3 py-2 text-[13px] leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood ${active ? "bg-hood-wash font-medium text-hood-deep" : "text-ink-soft hover:bg-panel hover:text-ink"}`}
                >
                  {entry.title}
                  {terms.length > 0 ? (
                    <span className="mt-1 block text-[12px] font-normal text-ink-faint">
                      {entry.description}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
        {matches.length === 0 ? (
          <p className="text-[13px] text-ink-soft">
            Try a shorter term, such as wallet, Telegram or price.
          </p>
        ) : null}
      </div>
    </nav>
  );
}
