"use client";

import { useCallback, useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "@/components/ui/icons";

const REFRESH_MS = 30_000;

export function RefreshReading({ automatic = false, controls = true }: { automatic?: boolean; controls?: boolean } = {}): React.ReactElement | null {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refreshing = useRef(false);

  useEffect(function releaseRefresh() {
    if (!pending) refreshing.current = false;
  }, [pending]);

  const refresh = useCallback(function refresh(): void {
    if (document.hidden || refreshing.current) return;
    refreshing.current = true;
    startTransition(function requestReading() {
      router.refresh();
    });
  }, [router, startTransition]);

  useEffect(function refreshVisibleReading() {
    if (!automatic) return;
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return function stop() {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [automatic, refresh]);

  if (!controls) return null;
  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" onClick={refresh} disabled={pending} aria-busy={pending}
        className="inline-flex h-11 items-center gap-2 rounded-lg border border-line px-3 text-[12px] text-ink hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:opacity-50">
        <RotateCcw className={`h-3.5 w-3.5 ${pending ? "motion-safe:animate-spin" : ""}`} />
        {pending ? "Refreshing" : "Refresh"}
      </button>
      <span className="sr-only">Updates every 30 seconds while this tab is visible.</span>
    </div>
  );
}
