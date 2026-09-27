"use client";

import { useEffect } from "react";
import { RotateCcw } from "@/components/ui/icons";

// Scoped to the app shell, so a failing dashboard page keeps the sidebar and the
// user keeps their navigation instead of losing the whole chrome.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(
    function report() {
      console.error("Dashboard render error", error);
    },
    [error],
  );

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-[40ch] text-center">
        <p className="mono-label">error</p>
        <h1 className="display mt-3 text-[22px] text-ink">This page didn&apos;t load.</h1>
        <p className="mt-2 text-[13.5px] leading-6 text-ink-soft">
          Your projects and credits are unaffected.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-faint">ref {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
          Try again
        </button>
      </div>
    </div>
  );
}
