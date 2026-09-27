import Link from "@/components/ui/navigation-link";
import { WalletButton } from "@/components/wallet-button";
import { STARTER_CREDITS } from "@/lib/config";

// What a signed-out visitor sees on a dashboard page. The dashboard is open to look
// around; the moment they act, they need a wallet, and this says so before they try.
export function GuestPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-xl rounded-card border border-line bg-raised px-7 py-12 text-center">
        <p className="mono-label mb-4">signed out</p>
        <h1 className="display text-[24px] text-ink">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-7 text-ink-soft">{body}</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <WalletButton tone="light" />
          <Link
            href="/dashboard/build"
            className="rounded-md px-3.5 py-2 text-[13.5px] text-ink-soft transition-colors hover:bg-panel hover:text-ink"
          >
            Try the console first
          </Link>
        </div>
        <p className="mt-6 font-mono text-[11.5px] text-ink-faint">
          {STARTER_CREDITS} free build credit for each new address · no card
        </p>
      </div>
    </div>
  );
}
