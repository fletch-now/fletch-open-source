"use client";

import Link from "@/components/ui/navigation-link";

import { useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy, ExternalLink } from "@/components/ui/icons";
import type { DeliveryRow } from "@/lib/watch/queries";
import type { DeliveryStatus } from "@/lib/watch/types";

// Shared by the watcher detail page's run history and the alerts inbox — the
// only difference between the two is whether each row also names its watcher.
export interface DeliveryListItem extends DeliveryRow {
  watcherName?: string;
}

interface DeliveryListProps {
  deliveries: DeliveryListItem[];
  emptyState: ReactNode;
  showWatcherName?: boolean;
}

const STATUS_META: Record<DeliveryStatus, { label: string; tone: string }> = {
  pending: { label: "pending", tone: "bg-panel text-ink-faint" },
  sent: { label: "sent", tone: "bg-hood-wash text-hood-deep" },
  failed: { label: "failed", tone: "bg-red-50 text-red-700" },
  retracted: { label: "retracted", tone: "bg-amber-50 text-amber-700" },
  held: { label: "detected", tone: "bg-hood-wash text-hood-deep" },
};

const RETRACTED_MEANING = "The sequencer reordered this block; the alert was withdrawn.";

function formatAmount(amount: string): string {
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

function shortAddress(address: string): string {
  if (address.length <= 10) {
    return address;
  }
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface AddressCopyProps {
  address: string;
}

function AddressCopy({ address }: AddressCopyProps): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try { await navigator.clipboard.writeText(address); } catch { return; }
    setCopied(true);
    setTimeout(function reset() {
      setCopied(false);
    }, 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      className="inline-flex min-h-11 items-center gap-1 break-all font-mono text-[12px] text-ink-soft transition-colors hover:text-ink"
    >
      {shortAddress(address)}
      {copied ? (
        <Check className="h-3 w-3 shrink-0 text-hood-deep" strokeWidth={2.2} />
      ) : (
        <Copy className="h-3 w-3 shrink-0" strokeWidth={1.8} />
      )}
    </button>
  );
}

// What sits under the status badge: sent gives a relative time, failed surfaces
// the real error, retracted explains the reorg rather than leaving the word
// unexplained, pending needs nothing more.
function statusDetail(delivery: DeliveryListItem): string | null {
  if (delivery.status === "sent") {
    return delivery.sentAt ? `sent ${formatWhen(delivery.sentAt)}` : "sent";
  }
  if (delivery.status === "failed") {
    return delivery.lastError ?? "delivery failed";
  }
  if (delivery.status === "held") {
    return "Saved in your dashboard. This notification is held. Link Telegram or choose a new webhook to send matches from the last 24 hours.";
  }
  if (delivery.status === "retracted") {
    return RETRACTED_MEANING;
  }
  return null;
}

export function DeliveryList({ deliveries, emptyState, showWatcherName }: DeliveryListProps): ReactNode {
  if (deliveries.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-raised">
      {deliveries.map(function renderDelivery(delivery) {
        const meta = STATUS_META[delivery.status];
        const detail = statusDetail(delivery);
        return (
          <li key={delivery.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
                {delivery.payload.kind === "wallet_activity" ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      delivery.payload.direction === "in" ? "bg-hood-wash text-hood-deep" : "bg-panel text-ink-soft"
                    }`}
                  >
                    {delivery.payload.direction}
                  </span>
                ) : null}
                {showWatcherName && delivery.watcherName ? (
                  <span className="break-words text-[12.5px] font-medium text-ink">{delivery.watcherName}</span>
                ) : null}
                <span className="text-[12.5px] text-ink-faint">{formatWhen(delivery.createdAt)}</span>
              </div>
              {delivery.payload.kind === "authority" ? (
                <p className="mt-1.5 break-words text-[13px] text-ink">{delivery.payload.title}</p>
              ) : null}
              {delivery.payload.kind === "new_pool" ? (
                <p className="mt-1.5 break-words text-[13px] text-ink">
                  New pool: {delivery.payload.symbol ?? "unnamed token"}
                  {delivery.payload.quote ? ` / ${delivery.payload.quote}` : ""} on {delivery.payload.venue.replace("_", " ")}
                </p>
              ) : null}
              {delivery.payload.kind === "authority" || delivery.payload.kind === "new_pool" ? null : (
                <>
                  <p className="mt-1.5 font-mono text-[13px] text-ink">
                    {formatAmount(delivery.payload.amount)} {delivery.payload.symbol}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-faint">
                    <AddressCopy address={delivery.payload.from} />
                    <span aria-hidden="true">→</span>
                    <AddressCopy address={delivery.payload.to} />
                  </div>
                </>
              )}
              {detail ? (
                <p className={`mt-1.5 text-[12.5px] ${delivery.status === "failed" ? "text-red-600" : "text-ink-faint"}`}>
                  {delivery.status === "held" ? (
                    <Link href="/dashboard/settings" className="mr-2 text-hood-deep underline underline-offset-4 hover:text-ink">
                      Notification settings
                    </Link>
                  ) : null}
                  {detail}
                </p>
              ) : null}
            </div>
            {delivery.payload.explorerUrl ? (
              <a
                href={delivery.payload.explorerUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[12.5px] text-hood-deep underline underline-offset-4 transition-colors hover:text-ink"
              >
                {delivery.payload.kind === "new_pool" ? "Pool" : "Transaction"} <ExternalLink className="h-3 w-3" strokeWidth={1.8} />
              </a>
            ) : (
              <a
                href={delivery.payload.kind === "authority" ? delivery.payload.registryUrl : "/registry/changes"}
                className="inline-flex min-h-11 shrink-0 items-center gap-1 text-[12.5px] text-hood-deep underline underline-offset-4 transition-colors hover:text-ink"
              >
                changelog
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
