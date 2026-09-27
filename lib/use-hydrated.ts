"use client";

import { useSyncExternalStore } from "react";

function subscribe(): () => void { return function unsubscribe(): void {}; }
function clientReady(): boolean { return true; }
function serverReady(): boolean { return false; }

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, clientReady, serverReady);
}
