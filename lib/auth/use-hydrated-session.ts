"use client";

import { useSyncExternalStore } from "react";
import { authClient } from "@/lib/auth-client";

function subscribe(): () => void {
  return function unsubscribe() {};
}

function clientSnapshot(): boolean {
  return true;
}

function serverSnapshot(): boolean {
  return false;
}

// A different client island can populate BetterAuth's cache before this one
// hydrates. Keep its first browser render equal to the server, then use the cache.
export function useHydratedSession(): ReturnType<typeof authClient.useSession>["data"] {
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const { data: session } = authClient.useSession();
  return hydrated ? session : null;
}
