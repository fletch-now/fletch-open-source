"use client";

import Link from "@/components/ui/navigation-link";
import { TrustBadge } from "@/components/registry/trust-badge";
import type { TrustLevel } from "@/lib/registry/trust-rules";
import { useState } from "react";
import { Check, Copy } from "@/components/ui/icons";

// Every cell arrives as text from the server page: this component only lays
// the rows out and owns the copy button, so it never has to know how a
// multiplier or a price is formatted.
export interface AssetTableRow {
  id: string;
  symbol: string;
  name: string;
  assetType: string;
  address: string;
  trust: TrustLevel;
  verified: boolean;
  multiplier: string;
  price: string;
  holders: string;
  lookalikes: number;
  paused: boolean;
  halted: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  stock_token: "Stock token",
  stablecoin: "Stablecoin",
  wrapped_native: "Wrapped native",
  bridged: "Bridged",
};

interface AssetTableProps {
  rows: AssetTableRow[];
}

function flags(row: AssetTableRow): string[] {
  const list: string[] = [];
  if (row.paused) {
    list.push("paused");
  }
  if (row.halted) {
    list.push("halted");
  }
  return list;
}

export function AssetTable({ rows }: AssetTableProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copyAddress(row: AssetTableRow): Promise<void> {
    await navigator.clipboard.writeText(row.address).catch(function ignore() {});
    setCopiedId(row.id);
    setTimeout(function reset() {
      setCopiedId(function clearIfStillThis(id) {
        return id === row.id ? null : id;
      });
    }, 1600);
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
        <p className="text-[15px] text-ink">No asset matches these filters.</p>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
          Try a ticker, or{" "}
          <Link href="/dashboard/registry" className="underline underline-offset-4">
            clear the filters
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-raised">
      <table className="w-full min-w-[980px] border-collapse text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-line text-[11px] uppercase tracking-wide text-ink-faint">
            <th className="px-4 py-2.5 font-medium">Symbol</th>
            <th className="px-4 py-2.5 font-medium">Name</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Address</th>
            <th className="px-4 py-2.5 text-right font-medium">Multiplier</th>
            <th className="px-4 py-2.5 text-right font-medium">Price</th>
            <th className="px-4 py-2.5 text-right font-medium">Holders</th>
            <th className="px-4 py-2.5 text-right font-medium">Lookalikes</th>
            <th className="px-4 py-2.5 font-medium">State</th>
            <th className="px-4 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody>
          {rows.map(function renderRow(row) {
            const warnings = flags(row);
            return (
              <tr key={row.id} className="border-b border-line last:border-0">
                <td className="px-4 py-3 font-medium text-ink">
                  <Link href={`/registry/${row.symbol}`} className="hover:text-hood-deep hover:underline">
                    {row.symbol}
                  </Link>
                </td>
                <td className="max-w-[260px] truncate px-4 py-3 text-ink-soft">
                  <Link href={`/registry/${row.symbol}`} className="hover:text-ink">
                    {row.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink-faint">{TYPE_LABEL[row.assetType] ?? row.assetType}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[12px] text-ink-soft">
                      {row.address.slice(0, 8)}…{row.address.slice(-6)}
                    </span>
                    <button
                      type="button"
                      onClick={function onCopy() {
                        void copyAddress(row);
                      }}
                      aria-label={`Copy ${row.symbol} address`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-panel hover:text-ink"
                    >
                      {copiedId === row.id ? <Check className="h-3.5 w-3.5 text-hood-deep" strokeWidth={2.2} /> : <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />}
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-ink">{row.multiplier}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-ink">{row.price}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums text-ink">{row.holders}</td>
                <td className="px-4 py-3 text-right font-mono text-[12.5px] tabular-nums">
                  {row.lookalikes > 0 ? (
                    <Link href={`/registry/${row.symbol}#lookalikes`} className="text-amber-700 underline-offset-4 hover:underline">
                      {row.lookalikes}
                    </Link>
                  ) : (
                    <span className="text-ink-faint">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px]">
                  {warnings.length > 0 ? (
                    <span className="text-amber-700">{warnings.join(" · ")}</span>
                  ) : (
                    <TrustBadge level={row.trust} />
                  )}
                </td>
                <td className="px-2 py-3 text-right">
                  <Link
                    href={`/dashboard/watch/new?asset=${row.id}`}
                    className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                  >
                    Watch
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
