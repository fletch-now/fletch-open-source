import Link from "@/components/ui/navigation-link";
import { FileQuestion } from "@/components/ui/icons";

// Rendered when notFound() is called inside a dashboard route — a missing project,
// for example. It sits inside the app shell, so the sidebar stays put.
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center px-4 py-16 text-center">
      <span className="mb-5 grid h-11 w-11 place-items-center text-ink-faint">
        <FileQuestion className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <h1 className="display text-[22px] text-ink">Not found</h1>
      <p className="mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
        This page does not exist, or it belongs to another account.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          href="/dashboard"
          className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
        >
          Overview
        </Link>
        <Link
          href="/dashboard/build"
          className="rounded-full border border-line px-4 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          New build
        </Link>
      </div>
    </div>
  );
}
