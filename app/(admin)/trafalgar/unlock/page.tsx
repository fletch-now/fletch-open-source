import Link from "@/components/ui/navigation-link";
import { Wordmark } from "@/components/brand/fletch-mark";
import { UnlockForm } from "@/components/admin/unlock-form";
import { adminPasswordConfigured } from "@/lib/admin/gate";

export const metadata = { title: "Operator console", robots: { index: false, follow: false } };

// Rendered per request: whether a password is configured is read from the
// server's environment, and a build-time snapshot of that answer went stale.
export const dynamic = "force-dynamic";

// The console's door: the operator password and nothing else. It never shows
// the console's shell, and it does not ask for a wallet.
export default function AdminUnlockPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-16">
      <div className="w-full max-w-sm">
        <Link href="/" className="inline-flex">
          <Wordmark />
        </Link>
        <p className="mono-label mt-8">operator console</p>
        <h1 className="display mt-2 text-[30px] leading-tight text-ink">Enter the console password.</h1>
        <p className="mt-3 text-[14.5px] leading-6 text-ink-soft">
          The console stays open for twelve hours on this browser, or until you lock it.
        </p>
        <UnlockForm configured={adminPasswordConfigured()} />
      </div>
    </div>
  );
}
