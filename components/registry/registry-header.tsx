import Link from "@/components/ui/navigation-link";
import { FletchMark } from "@/components/brand/fletch-mark";
import { WalletButton } from "@/components/wallet-button";
import { ArrowRight } from "@/components/ui/icons";
import { CommunityLinks } from "@/components/landing/community-links";

// The registry's own header: the same width as the table beneath it, the mark
// and a "registry" label on the left, the wallet and one large call to action on
// the right. The site's marketing header does not belong on a working page.

export function RegistryHeader({ section = "registry" }: { section?: "registry" | "docs" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-xl">
      <div className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-2 px-3 sm:gap-x-4 sm:px-6 lg:px-8">
        <Link href="/" aria-label={`Fletch ${section} home`} className="flex min-h-11 shrink-0 items-center gap-2">
          <FletchMark size={18} className="text-hood-deep" />
          <span className="display text-[19px] tracking-[-0.03em] text-ink max-[360px]:hidden">Fletch</span>{" "}
          <span className="ml-1 hidden rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint sm:inline">
            {section}
          </span>
        </Link>
        <div className="flex items-center gap-1 sm:gap-3">
          <div className="hidden items-center pr-2 md:flex" aria-label="Community links"><CommunityLinks compact includeGithub tone="light" /></div>
          <Link href="/docs" className="inline-flex h-11 items-center px-2 text-[13px] text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-hood">Docs</Link>
          <WalletButton tone="light" />
          <Link
            href="/dashboard"
            aria-label="Open the dashboard"
            title="Open the dashboard"
            className="group inline-flex h-11 w-11 items-center justify-center gap-2 rounded-full bg-ink px-3 text-[13.5px] font-semibold text-paper transition-colors hover:bg-ink/90 sm:w-auto sm:px-5"
          >
            <span className="hidden sm:inline">Open the dashboard</span>
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} />
          </Link>
        </div>
        <div className="flex w-full items-center justify-end border-t border-line/60 md:hidden" aria-label="Community links"><CommunityLinks compact includeGithub tone="light" /></div>
      </div>
    </header>
  );
}
