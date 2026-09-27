import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";

export function RegistryFooter(): ReactElement {
  return <footer className="mt-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line px-4 py-6 text-[13px] text-ink-soft sm:px-6 lg:px-8">
    <p>Fletch Registry · Observed data on Robinhood Chain.</p>
    <nav aria-label="Registry resources" className="flex flex-wrap gap-x-5 gap-y-2 [&>a]:inline-flex [&>a]:min-h-8 [&>a]:items-center [&>a]:underline [&>a]:underline-offset-4"><Link href="/dashboard">Builder</Link><Link href="/developers">API and agents</Link><Link href="/registry/status">Status</Link><a href="https://github.com/fletch-now">GitHub</a><Link href="/docs">Docs</Link><a href="/skill.md">AI guide</a></nav>
  </footer>;
}
