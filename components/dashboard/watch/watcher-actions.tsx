"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Pause/resume/delete for the detail page — the same fetch pattern as
// watcher-list.tsx's inline actions, pulled into its own component because the
// list can't be reused here: this is one watcher, not a row in a list, and a
// delete needs to navigate away rather than just drop a row.

interface WatcherActionsProps {
  watcherId: string;
  watcherName: string;
  enabled: boolean;
}

export function WatcherActions({ watcherId, watcherName, enabled }: WatcherActionsProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleEnabled(): Promise<void> {
    setPending(true);
    setError(null);
    const response = await fetch(`/api/watchers/${watcherId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: !enabled }),
    }).catch(function ignore() {
      return null;
    });
    setPending(false);
    if (!response?.ok) {
      const body = await response?.json().catch(function ignore() {
        return null;
      });
      setError(body?.error ?? "Couldn't update this watcher.");
      return;
    }
    router.refresh();
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Delete "${watcherName}"? This can't be undone.`)) {
      return;
    }
    setPending(true);
    setError(null);
    const response = await fetch(`/api/watchers/${watcherId}`, { method: "DELETE" }).catch(function ignore() {
      return null;
    });
    setPending(false);
    if (!response?.ok) {
      const body = await response?.json().catch(function ignore() {
        return null;
      });
      setError(body?.error ?? "Couldn't delete this watcher.");
      return;
    }
    router.push("/dashboard/watch");
    router.refresh();
  }

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={function onToggle() {
            void toggleEnabled();
          }}
          disabled={pending}
          className="flex h-11 items-center rounded-full border border-line px-4 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          {enabled ? "Pause" : "Resume"}
        </button>
        <button
          type="button"
          onClick={function onDelete() {
            void remove();
          }}
          disabled={pending}
          className="flex h-11 items-center rounded-full border border-line px-4 text-[13px] text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
        >
          Delete
        </button>
      </div>
      {error ? <p className="max-w-xs text-right text-[13px] text-red-600">{error}</p> : null}
    </div>
  );
}
