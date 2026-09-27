"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { TelegramMark } from "@/components/brand/telegram-mark";

// A watcher, started from the landing page in three clicks: pick a verified Stock
// Token, set the amount, go. The list is the live registry, so what is offered here
// is exactly what the dashboard can watch. The third click is the sign-in the
// dashboard asks for; nothing is created until then.

export interface TryAsset {
  id: string;
  symbol: string;
  name: string;
}

interface WatchTryProps {
  assets: TryAsset[];
}

const PRESETS = ["10000", "100000", "1000000"];

export function WatchTry({ assets }: WatchTryProps) {
  const router = useRouter();
  const [assetId, setAssetId] = useState(assets[0]?.id ?? "");
  const [threshold, setThreshold] = useState(PRESETS[1]);
  const chosen = assets.find(function match(asset) {
    return asset.id === assetId;
  });

  function go(): void {
    const params = new URLSearchParams({ asset: assetId, threshold });
    router.push(`/dashboard/watch/new?${params.toString()}`);
  }

  if (assets.length === 0) {
    return null;
  }

  return (
    <div className="rounded-card bg-raised p-5 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="mono-label">watch in three clicks</p>
        <p className="font-mono text-[11px] text-ink-faint">{assets.length} verified assets</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-soft">Asset</span>
          <select
            value={assetId}
            onChange={function pick(event) {
              setAssetId(event.target.value);
            }}
            className="h-11 rounded-lg border border-line bg-paper px-3 text-[14px] text-ink focus:border-hood/60 focus:outline-none"
          >
            {assets.map(function renderOption(asset) {
              return (
                <option key={asset.id} value={asset.id}>
                  {asset.symbol} — {asset.name}
                </option>
              );
            })}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-soft">Alert on transfers over</span>
          <div className="flex h-11 items-center gap-1 rounded-lg border border-line bg-paper px-1">
            {PRESETS.map(function renderPreset(preset) {
              const on = preset === threshold;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={function set() {
                    setThreshold(preset);
                  }}
                  className={`h-9 flex-1 rounded-md font-mono text-[12px] tabular-nums transition-colors ${
                    on ? "bg-ink text-paper" : "text-ink-soft hover:bg-panel"
                  }`}
                >
                  {Number(preset).toLocaleString()}
                </button>
              );
            })}
          </div>
        </label>
        <button
          type="button"
          onClick={go}
          className="inline-flex h-11 items-center justify-center gap-2 self-end rounded-full bg-hood px-5 text-[14px] font-semibold text-black transition-colors hover:bg-hood-strong"
        >
          <TelegramMark size={13} />
          Watch {chosen?.symbol ?? ""}
        </button>
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-ink-faint">
        Sign in with a wallet on the next screen, link Telegram once, and the alert runs
        on Fletch&apos;s server from then on. Free during the beta.
      </p>
    </div>
  );
}
