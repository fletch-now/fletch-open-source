"use client";

import { useEffect, useState } from "react";
import { Coins, Cpu, Radar, Wifi } from "@/components/ui/icons";

// Live answer to "can I prompt right now?". Without it the build box looks ready
// even when the database is down, no model key is set, or credits have run out —
// and the failure only shows up after the user has typed a prompt.

const POLL_MS = 60_000;

// Same threshold as app/(dashboard)/dashboard/watch/page.tsx's daemonLine — one
// "is the daemon alive" definition, not two that can quietly disagree.
const WATCH_STALE_SECONDS = 60;

interface WatchStatus {
  heartbeatAgeSeconds: number | null;
  headBlock: string | null;
  rpcConfigured: boolean;
  telegramConfigured: boolean;
}

interface Status {
  db: boolean;
  runtime: { ready: boolean; model: string | null; mode: string; sandboxed: boolean };
  credits: number;
  canBuild: boolean;
  watch: WatchStatus;
}

const WATCH_UNKNOWN: WatchStatus = {
  heartbeatAgeSeconds: null,
  headBlock: null,
  rpcConfigured: false,
  telegramConfigured: false,
};

function watchRow(watch: WatchStatus): { value: string; ok: boolean; title: string } {
  const detail = `RPC: ${watch.rpcConfigured ? "configured" : "public fallback"} · Telegram: ${
    watch.telegramConfigured ? "linked" : "not configured"
  }${watch.headBlock ? ` · head ${watch.headBlock}` : ""}`;

  if (watch.heartbeatAgeSeconds === null) {
    return { value: "not running", ok: false, title: detail };
  }
  const ageSeconds = Math.round(watch.heartbeatAgeSeconds);
  const fresh = ageSeconds <= WATCH_STALE_SECONDS;
  return { value: `${ageSeconds}s ago`, ok: fresh, title: detail };
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {ok ? (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-hood opacity-60" />
      ) : null}
      <span
        className={`relative inline-flex h-1.5 w-1.5 rounded-full ${ok ? "bg-hood" : "bg-red-500"}`}
      />
    </span>
  );
}

interface SystemStatusProps {
  collapsed: boolean;
  // The status route needs a session; polling it signed out only logs a 401 in
  // the browser console on every tick.
  signedIn: boolean;
}

const SIGNED_OUT: Status = {
  db: true,
  runtime: { ready: true, model: "connect a wallet", mode: "agent", sandboxed: true },
  credits: 0,
  canBuild: false,
  watch: WATCH_UNKNOWN,
};

function runtimeLabel(runtime: { ready: boolean; model: string | null; sandboxed: boolean }): string {
  if (runtime.model === "connect a wallet") {
    return runtime.model;
  }
  if (!runtime.ready) {
    return "not set";
  }
  return runtime.sandboxed ? "sandboxed agent" : "agent";
}

export function SystemStatus({ collapsed, signedIn }: SystemStatusProps) {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(function poll() {
    let live = true;
    if (!signedIn) {
      return;
    }

    async function load(): Promise<void> {
      const response = await fetch("/api/status").catch(function ignore() {
        return null;
      });
      if (!live) {
        return;
      }
      if (response?.status === 401) {
        setStatus(SIGNED_OUT);
        return;
      }
      if (!response?.ok) {
        // A failed fetch is itself a status: the server is not answering.
        setStatus({
          db: false,
          runtime: { ready: false, model: null, mode: "unknown", sandboxed: false },
          credits: 0,
          canBuild: false,
          watch: WATCH_UNKNOWN,
        });
        return;
      }
      setStatus((await response.json()) as Status);
    }

    // A hidden tab does not poll; it refreshes once when it comes back.
    function tick(): void {
      if (!document.hidden) {
        void load();
      }
    }
    void load();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("fletch:credits-updated", tick);
    return function stop() {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("fletch:credits-updated", tick);
    };
  }, [signedIn]);

  const shown = signedIn ? status : SIGNED_OUT;
  if (!shown) {
    return collapsed ? null : (
      <div className="mx-2 mb-2 h-[86px] animate-pulse rounded-lg bg-panel" />
    );
  }

  if (collapsed) {
    return (
      <div
        className="mb-2 flex justify-center"
        title={shown.canBuild ? "Ready to build" : "Not ready to build"}
      >
        <Dot ok={shown.canBuild} />
      </div>
    );
  }

  const watch = watchRow(shown.watch);

  const rows = [
    { icon: Wifi, label: "API", value: shown.db ? "online" : "offline", ok: shown.db, title: undefined },
    {
      icon: Cpu,
      label: "Runtime",
      value: runtimeLabel(shown.runtime),
      ok: shown.runtime.ready,
      title: undefined,
    },
    {
      icon: Coins,
      label: "Credits",
      value: String(shown.credits),
      ok: shown.credits > 0,
      title: undefined,
    },
    { icon: Radar, label: "Watch", value: watch.value, ok: watch.ok, title: watch.title },
  ];

  return (
    <div className="mx-2 mb-2 overflow-hidden rounded-lg border border-line bg-panel/50">
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
        <Dot ok={shown.canBuild} />
        <span className="mono-label !text-[9.5px]">
          {shown.canBuild ? "ready to build" : shown.runtime.model === "connect a wallet" ? "connect a wallet" : "cannot build"}
        </span>
      </div>
      <ul className="space-y-1 px-2.5 py-2">
        {rows.map(function renderRow(row) {
          const Icon = row.icon;
          return (
            <li key={row.label} className="flex items-center gap-2" title={row.title}>
              <Icon className="h-3 w-3 shrink-0 text-ink-faint" strokeWidth={1.8} />
              <span className="text-[11.5px] text-ink-faint">{row.label}</span>
              <span
                className={`ml-auto truncate font-mono text-[10.5px] tabular-nums ${
                  row.ok ? "text-ink-soft" : "text-red-600"
                }`}
              >
                {row.value}
              </span>
            </li>
          );
        })}
      </ul>
      {shown.runtime.sandboxed ? (
        <p className="border-t border-line px-2.5 py-1.5 font-mono text-[9.5px] text-ink-faint">
          sandboxed · foundry
        </p>
      ) : null}
    </div>
  );
}
