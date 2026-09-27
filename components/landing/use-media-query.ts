import { useSyncExternalStore } from "react";

// A media query as a store, so a component can pick a layout without an effect
// and a second render. The server snapshot is false: the page is served in its
// small-screen form and widens on the client, which costs nothing visible because
// the parts that differ are below the fold and client-only anyway.

function subscribe(query: string): (onChange: () => void) => () => void {
  return function start(onChange) {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return function stop() {
      list.removeEventListener("change", onChange);
    };
  };
}

function serverSnapshot(): boolean {
  return false;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    function snapshot() {
      return window.matchMedia(query).matches;
    },
    serverSnapshot,
  );
}
