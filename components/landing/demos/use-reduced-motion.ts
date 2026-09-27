"use client";

import { useSyncExternalStore } from "react";

// The four demos each reimplemented this as "set state from matchMedia inside an
// effect", which is a synchronous setState during mount — a cascading second render
// and a lint error four times over. useSyncExternalStore is the API built for
// exactly this: subscribe to an external source, read a snapshot, no effect at all.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  const list = window.matchMedia(QUERY);
  list.addEventListener("change", onChange);
  return function unsubscribe() {
    list.removeEventListener("change", onChange);
  };
}

function getSnapshot(): boolean {
  return window.matchMedia(QUERY).matches;
}

// On the server there is no preference to read; assume motion, which is also what
// the client will show unless the OS says otherwise.
function getServerSnapshot(): boolean {
  return false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
