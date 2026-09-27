"use client";

import { useState, type ReactElement } from "react";

export function BuildRecovery({ buildId, onResumed }: { buildId: string; onResumed: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function resume(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/builds/${buildId}/continue`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not check the saved build.");
      setMessage(body.message);
      if (body.queued || body.running) onResumed();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Could not reach the server. Your saved work is retained.");
    } finally { setBusy(false); }
  }
  return <div className="space-y-2 rounded-xl border border-line bg-panel/40 p-3 text-xs text-ink-soft" data-build-recovery>
    <p>Recovery runs automatically when a saved step can be resumed safely. You can check again here.</p>
    <button type="button" disabled={busy} onClick={() => { void resume(); }} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-paper px-3 text-ink disabled:opacity-50">
      {busy ? <span aria-hidden className="h-3 w-3 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" /> : null}
      {busy ? "Checking saved progress…" : "Continue build"}
    </button>
    {message ? <p role="status" className="leading-5">{message}</p> : null}
  </div>;
}
