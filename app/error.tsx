"use client";

import { useEffect } from "react";
import { RotateCcw } from "@/components/ui/icons";

// Without this, an unhandled render error shows the framework's default page.
// Users get a readable failure and a way out; the detail goes to the server log.
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(
    function report() {
      console.error("Unhandled application error", error);
    },
    [error],
  );

  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="max-w-[42ch] text-center">
        <p className="mono-label">error</p>
        <h1 className="display mt-3 text-[26px] text-ink">That didn&apos;t load.</h1>
        <p className="mt-2 text-[14px] leading-6 text-ink-soft">
          Something broke while rendering this page. Trying again often works; if it
          doesn&apos;t, the reference below helps us find it.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-ink-faint">ref {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
          Try again
        </button>
      </div>
    </main>
  );
}
