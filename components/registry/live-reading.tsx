"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactElement } from "react";

const listeners = new Set<() => void>();
let clock = 0;
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
  clock = Date.now();
  for (const listener of listeners) listener();
}

function visibility(): void {
  clearInterval(timer);
  timer = undefined;
  if (!document.hidden) {
    tick();
    timer = setInterval(tick, 1_000);
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", visibility);
    visibility();
  }
  return function unsubscribe(): void {
    listeners.delete(listener);
    if (!listeners.size) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", visibility);
    }
  };
}

function relativeAge(at: string): string {
  const seconds = Math.max(0, Math.round((clock - Date.parse(at)) / 1_000));
  if (!Number.isFinite(seconds)) return "Time unavailable";
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

export function LiveAge({ at, initialLabel, className }: { at: string; initialLabel: string; className?: string }): ReactElement {
  const label = useSyncExternalStore(subscribe, () => relativeAge(at), () => initialLabel);
  return <time dateTime={at} title={at} className={className} data-live-age>{label}</time>;
}

function useExpired(expiresAt: string | null | undefined): boolean {
  return useSyncExternalStore(subscribe, () => Boolean(expiresAt && clock >= Date.parse(expiresAt)), () => false);
}

export function LiveValue({ value, expiresAt, className }: { value: string; expiresAt?: string | null; className?: string }): ReactElement {
  const expired = useExpired(expiresAt);
  const shown = expired ? "Unavailable" : value;
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef(shown);
  useEffect(function animateChangedReading() {
    if (previous.current === shown) return;
    previous.current = shown;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.current?.animate([
      { opacity: 0.45, transform: "translateY(4px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 240, easing: "ease-out" });
    return () => animation?.cancel();
  }, [shown]);
  return <span ref={element} className={`inline-block ${className ?? ""}`} data-live-value title={expired ? "This observation expired. Waiting for a current source reading." : undefined}>{shown}</span>;
}

export function ReadingExpiry({ expiresAt, stale = false }: { expiresAt?: string | null; stale?: boolean }): ReactElement | null {
  const expired = useExpired(expiresAt);
  return stale || expired ? <p className="text-[12px] leading-5 text-ink-soft">Stale observation</p> : null;
}
