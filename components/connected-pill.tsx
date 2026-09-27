"use client";

import { useEffect, useRef, useState } from "react";
import Link from "@/components/ui/navigation-link";

// The signed-in state of the wallet button: a green pill carrying the wallet's
// short address, which opens a small menu with the dashboard and a disconnect.
// The address comes from wagmi when the wallet has reconnected on this page;
// until then the account's handle stands in, so the pill never reads blank.

interface ConnectedPillProps {
  address?: string;
  handle: string;
  night: boolean;
  onDisconnect: () => Promise<void>;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ConnectedPill({
  address,
  handle,
  night,
  onDisconnect,
}: ConnectedPillProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(
    function closeOnOutsideClick() {
      if (!open) {
        return;
      }
      function onPointerDown(event: PointerEvent): void {
        if (
          hostRef.current &&
          !hostRef.current.contains(event.target as Node)
        ) {
          setOpen(false);
        }
      }
      document.addEventListener("pointerdown", onPointerDown);
      return function stop() {
        document.removeEventListener("pointerdown", onPointerDown);
      };
    },
    [open],
  );

  const label = address ? shortAddress(address) : handle;
  const menuTone = night
    ? "border-white/15 bg-night text-white"
    : "border-line bg-raised text-ink";
  const itemTone = night ? "hover:bg-white/10" : "hover:bg-panel";

  return (
    <div ref={hostRef} className="relative min-w-0 max-w-full">
      <button
        type="button"
        onClick={function flip() {
          setOpen(function toggle(value) {
            return !value;
          });
        }}
        aria-label={address ?? handle}
        title={address ?? handle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-11 min-w-0 max-w-[min(42vw,240px)] items-center gap-2.5 whitespace-nowrap rounded-full bg-hood pl-3.5 pr-4 font-mono text-[13px] font-medium text-black shadow-[0_0_0_1px_rgba(0,0,0,0.08),0_8px_24px_-12px_rgba(0,200,5,0.8)] transition-colors hover:bg-hood-strong"
      >
        <span aria-hidden="true" className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-black/30" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-black" />
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </button>
      {open ? (
        <div
          role="menu"
          className={`absolute right-0 top-13 z-50 w-[220px] overflow-hidden rounded-2xl border p-1.5 shadow-[0_18px_50px_-20px_rgba(0,0,0,0.45)] ${menuTone}`}
        >
          <p
            className={`px-3 pb-1.5 pt-2 font-mono text-[10.5px] uppercase tracking-[0.14em] ${night ? "text-white/45" : "text-ink-faint"}`}
          >
            {address ? handle : "Signed in"}
          </p>
          <Link
            href="/dashboard"
            role="menuitem"
            className={`block rounded-xl px-3 py-2.5 text-[13.5px] font-medium ${itemTone}`}
          >
            Dashboard
          </Link>
          <Link
            href="/dashboard/build"
            role="menuitem"
            className={`block rounded-xl px-3 py-2.5 text-[13.5px] font-medium ${itemTone}`}
          >
            Start a build
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={onDisconnect}
            className={`block w-full rounded-xl px-3 py-2.5 text-left text-[13.5px] ${night ? "text-white/70" : "text-ink-soft"} ${itemTone}`}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}
