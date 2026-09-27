"use client";

import Link from "@/components/ui/navigation-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WatcherRow } from "@/lib/watch/queries";
import { StatusBadge, statusMeaning } from "@/components/dashboard/watch/status-badge";
import { deliveryTargetLabel } from "@/lib/watch/format";

// The dashboard's own view of a watcher: queries.ts gives us the row, the page
// joins in the registry symbol so this component never has to guess a name from
// a bare address.
export interface WatcherListItem extends WatcherRow {
  symbol: string;
}

interface WatcherListProps {
  watchers: WatcherListItem[];
}

function shortWallet(address: string): string {
  if (address.length <= 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

// The watcher's own line: what it's watching for, in one glance. large_transfer
// reads as an amount floor; wallet_activity reads as an address, with the floor
// only mentioned when it's not "every transfer".
function watcherSubtitle(watcher: WatcherListItem): string {
  switch (watcher.kind) {
    case "wallet_activity": {
      const min = Number(watcher.threshold) > 0 ? ` · min ${watcher.threshold}` : "";
      return watcher.wallet ? `${watcher.symbol} · ${shortWallet(watcher.wallet)}${min}` : `${watcher.symbol} · activity`;
    }
    case "listing_event":
      return "Robinhood app changes";
    case "registry_event":
      return "Registry · pauses, upgrades, blocks, listings, chain status";
    case "token_event":
      return `${watcher.symbol} · pauses, halts, multiplier, feed, supply`;
    case "new_pool":
      return "New pools recorded by the registry";
    default:
      return `${watcher.symbol} · above ${watcher.threshold}`;
  }
}

function formatAmount(amount: string | null): string {
  if (!amount) {
    return "";
  }
  const value = Number(amount);
  if (!Number.isFinite(value)) {
    return amount;
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatWhen(date: Date | null): string {
  if (!date) {
    return "";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

// Shared by toggleEnabled and remove below: both fire a watcher request, read
// back the API's { error } body on failure, and fall back to a generic
// message when the response has no body (e.g. the fetch itself threw).
async function submitWatcherRequest(
  request: () => Promise<Response>,
  fallbackError: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const response = await request().catch(function ignore() {
    return null;
  });
  if (!response?.ok) {
    const body = await response?.json().catch(function ignore() {
      return null;
    });
    return { ok: false, message: body?.error ?? fallbackError };
  }
  return { ok: true };
}

export function WatcherList({ watchers }: WatcherListProps): React.ReactNode {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<{ id: string; message: string } | null>(null);

  async function toggleEnabled(watcher: WatcherListItem): Promise<void> {
    setPendingId(watcher.id);
    setErrorId(null);
    const result = await submitWatcherRequest(
      () =>
        fetch(`/api/watchers/${watcher.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: !watcher.enabled }),
        }),
      "Couldn't update this watcher.",
    );
    setPendingId(null);
    if (!result.ok) {
      setErrorId({ id: watcher.id, message: result.message });
      return;
    }
    router.refresh();
  }

  async function remove(watcher: WatcherListItem): Promise<void> {
    if (!window.confirm(`Delete "${watcher.name}"? This can't be undone.`)) {
      return;
    }
    setPendingId(watcher.id);
    setErrorId(null);
    const result = await submitWatcherRequest(
      () => fetch(`/api/watchers/${watcher.id}`, { method: "DELETE" }),
      "Couldn't delete this watcher.",
    );
    setPendingId(null);
    if (!result.ok) {
      setErrorId({ id: watcher.id, message: result.message });
      return;
    }
    router.refresh();
  }

  if (watchers.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
        <p className="text-[15px] text-ink">No watchers yet.</p>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
          Watch transfers, token changes or new pools. Matches appear here, with optional Telegram or webhook notifications.
        </p>
        <Link
          href="/dashboard/watch/new"
          className="mt-6 inline-flex h-11 items-center rounded-full bg-hood px-5 text-[13px] font-semibold text-black transition-colors hover:bg-hood-strong"
        >
          Create a watcher
        </Link>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {watchers.map(function renderWatcher(watcher) {
        const busy = pendingId !== null;
        return (
          <li key={watcher.id} className="rounded-card border border-line bg-raised px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/watch/${watcher.id}`} className="break-words text-[14.5px] font-medium text-ink hover:underline">
                    {watcher.name}
                  </Link>
                  <StatusBadge status={watcher.status} />
                  {watcher.kind === "wallet_activity" ? (
                    <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-faint">wallet activity</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[13px] text-ink-faint">{statusMeaning(watcher.status)}</p>
                <p className="mt-2 font-mono text-[12px] text-ink-soft">{watcherSubtitle(watcher)}</p>
                <p className="mt-1 text-[12.5px] text-ink-faint">
                  Dashboard history · notifications via {deliveryTargetLabel(watcher.delivery, watcher.webhookName)}
                </p>
                <p className="mt-1 text-[12.5px] text-ink-faint">
                  Last match:{" "}
                  {watcher.lastDelivery ? (
                    <span className="text-ink-soft">
                      {watcher.lastDelivery.amount ? `${formatAmount(watcher.lastDelivery.amount)} ${watcher.symbol} · ` : ""}{formatWhen(watcher.lastDelivery.createdAt)}
                      {watcher.lastDelivery.status === "held" ? " · saved in dashboard" : ` · notification ${watcher.lastDelivery.status}`}
                    </span>
                  ) : (
                    "none yet"
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={function onToggle() {
                    void toggleEnabled(watcher);
                  }}
                  disabled={busy}
                  className="flex h-11 items-center rounded-full border border-line px-4 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
                >
                  {watcher.enabled ? "Pause" : "Resume"}
                </button>
                <button
                  type="button"
                  onClick={function onDelete() {
                    void remove(watcher);
                  }}
                  disabled={busy}
                  className="flex h-11 items-center rounded-full border border-line px-4 text-[13px] text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
            {errorId?.id === watcher.id ? <p className="mt-3 text-[13px] text-red-600">{errorId.message}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
