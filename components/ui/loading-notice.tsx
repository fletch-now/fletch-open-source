"use client";

import { useEffect, useState, type ReactElement } from "react";

const REGISTRY_NOTES = [
  "Robinhood Stock Tokens and crypto have separate catalogs.",
  "Each market reading has its own source time.",
  "Even a familiar ticker should bring ID. Check its contract address.",
  "A pool can exist before anyone trades in it.",
];

interface LoadingNoticeProps {
  title?: string;
  registry?: boolean;
}

export function LoadingNotice({ title = "Loading page", registry = false }: LoadingNoticeProps): ReactElement {
  const [note, setNote] = useState(0);

  useEffect(function rotateNotes() {
    if (!registry) return;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const timer = window.setInterval(function nextNote() {
      if (!preference.matches && !document.hidden) setNote((current) => (current + 1) % REGISTRY_NOTES.length);
    }, 6_000);
    return () => window.clearInterval(timer);
  }, [registry]);

  return <div className="w-full max-w-sm rounded-2xl border border-line bg-paper px-6 py-7 text-center shadow-xl">
    <span aria-hidden="true" className="mx-auto block h-11 w-11 rounded-full border-[3px] border-line border-t-hood motion-safe:animate-spin" />
    <p role="status" aria-live="polite" aria-atomic="true" className="mt-4 text-[18px] font-semibold tracking-tight text-ink">{title}</p>
    <div aria-hidden="true" className="mt-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink-soft">While you wait</p>
      <p className="mt-1 min-h-[3.75rem] text-[14px] leading-5 text-ink-soft">{registry ? REGISTRY_NOTES[note] : "You can keep browsing while this page loads."}</p>
    </div>
  </div>;
}
