"use client";

import { useEffect, useState } from "react";
import { FLTX_CONTRACT_ADDRESS } from "@/lib/fltx";

export function FltxContract({ dark = false }: { dark?: boolean }): React.ReactNode {
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 3000);
    return () => clearTimeout(timer);
  }, [message]);
  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(FLTX_CONTRACT_ADDRESS); setMessage("Copied"); }
    catch { setMessage("Select the address to copy it."); }
  }
  return (
    <div data-fltx-contract className={`min-w-0 rounded-xl border p-4 ${dark ? "border-white/15 bg-white/[0.03] text-white/75" : "border-line bg-raised text-ink-soft"}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className={`shrink-0 text-xs font-medium ${dark ? "text-hood" : "text-hood-deep"}`}>$FLTX contract</p>
        <code className="min-w-0 select-all break-all font-mono text-xs leading-6">{FLTX_CONTRACT_ADDRESS}</code>
        <button type="button" onClick={() => void copy()} aria-label="Copy FLTX contract address" className="min-h-11 shrink-0 rounded-lg border border-current/25 px-3 text-xs transition-colors hover:text-hood focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood sm:ml-auto">Copy address</button>
      </div>
      <span role="status" className={message ? "mt-1 block text-xs" : "sr-only"}>{message}</span>
    </div>
  );
}
