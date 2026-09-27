"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useHydratedSession } from "@/lib/auth/use-hydrated-session";
import type { HolderStatus } from "@/lib/holder-rewards/model";

interface Snapshot { key: string; status: HolderStatus | null; error: string | null }
let snapshot: Snapshot | null = null;
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
function read(): Snapshot | null { return snapshot; }
function serverRead(): null { return null; }
function update(value: Snapshot | null): void { snapshot = value; listeners.forEach(listener => listener()); }

export function HolderRewardMonitor(): React.ReactNode {
  const session = useHydratedSession();
  const key = session ? `${session.user.id}:${session.wallet ?? ""}` : null;
  useEffect(function monitor() {
    update(null);
    if (!key) return;
    const account = key;
    let stopped = false;
    let controller: AbortController | null = null;
    let nextCheck = 0;
    const notified = new Set<string>();
    async function check(): Promise<void> {
      if (document.hidden || stopped || controller || Date.now() < nextCheck) return;
      controller = new AbortController();
      const requestController = controller;
      const timeout = setTimeout(() => requestController.abort(), 25_000);
      nextCheck = Date.now() + 60_000;
      try {
        const response = await fetch("/api/credits/holder", { method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal });
        if (stopped) return;
        if (response.status === 401) { stopped = true; update(null); return; }
        if (!response.ok) throw new Error("Holder credits could not be checked. Retrying shortly.");
        const status = await response.json() as HolderStatus;
        if (stopped) return;
        update({ key: account, status, error: null });
        if (status.state === "granted" && status.grantId && !notified.has(status.grantId)) {
          notified.add(status.grantId);
          toast.success("10 $FLTX holder build credits added.");
          window.dispatchEvent(new Event("fletch:credits-updated"));
        }
      } catch {
        if (!stopped) update({ key: account, status: snapshot?.key === account ? snapshot.status : null, error: "Holder credits could not be checked. Retrying shortly." });
      } finally { clearTimeout(timeout); controller = null; }
    }
    function wake(): void { if (!document.hidden) void check(); }
    function requested(): void { nextCheck = 0; void check(); }
    void check();
    const timer = setInterval(wake, 10_000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("fletch:holder-check", requested);
    window.addEventListener("fletch:credits-updated", requested);
    return function stop() {
      stopped = true; controller?.abort(); clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("fletch:holder-check", requested);
      window.removeEventListener("fletch:credits-updated", requested);
      update(null);
    };
  }, [key]);
  return null;
}

export function useHolderReward(): Snapshot | null {
  const session = useHydratedSession();
  const value = useSyncExternalStore(subscribe, read, serverRead);
  const key = session ? `${session.user.id}:${session.wallet ?? ""}` : null;
  return value?.key === key ? value : null;
}

export function LiveCreditBalance({ initial, withLabel = true }: { initial: number | null; withLabel?: boolean }): React.ReactNode {
  const result = useHolderReward();
  const observed = result?.status;
  // A fresh server render takes precedence over an older holder-check snapshot.
  // Subsequent checks update the figure, even if the reward was already granted.
  const [reading, setReading] = useState({ initial, observed, balance: initial });
  if (reading.initial !== initial || reading.observed !== observed) {
    setReading({ initial, observed, balance: reading.initial !== initial ? initial : observed?.balance ?? reading.balance });
  }
  const balance = reading.balance;
  return <span className="tabular-nums" aria-live="polite">{balance === null ? "connect a wallet to build" : withLabel ? `${balance} ${balance === 1 ? "credit" : "credits"}` : balance}</span>;
}
