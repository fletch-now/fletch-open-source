"use client";

import type { ReactElement } from "react";
import { DemoShowcase, Metric, type Demo } from "@/components/landing/demo-showcase";

// The second demo band: the heavier machinery a prompt can produce — vaults,
// indexers, daemons. Same shell as the first band; only the data and the
// previews differ.

const DEMOS: Demo[] = [
  {
    id: "vault",
    badge: "DeFi protocol",
    title: "Testnet vaults",
    body: "Build a vault with deposits, shares and withdrawals on testnet. A demo strategy must label its test assets and calculate returns from funds the contract can pay.",
    prompt: "A yield vault dApp on Robinhood Chain: deposit USDG, show live TVL and target APY, stock tokens as collateral, with a Stake button.",
    address: "vault-aapl.apps.fletch.now",
  },
  {
    id: "indexer",
    badge: "Dev infra",
    title: "Event indexers",
    body: "Build a view of indexed contract events with their block numbers and decoding source. Show the covered range and any indexing delay.",
    prompt: "A real-time event indexer page: decoded Transfer logs for stock tokens streaming into a clean feed, with the raw JSON behind an endpoint.",
    address: "indexer.apps.fletch.now",
  },
  {
    id: "watcher",
    badge: "Automation",
    title: "Alert dashboards",
    body: "Design an alert dashboard with conditions and delivery history. Fletch Watch already supports mainnet events with dashboard matches and optional Telegram or webhook delivery.",
    prompt: "A block watcher dashboard: daemon status with current block and lag, plus a Telegram alert card for large transfers over a threshold.",
    address: "watcher.apps.fletch.now",
  },
];

const LOG_LINES = [
  { block: "52,910,104", pair: "TSLA / USDG", route: "0x8f3e…c41d → 0xd07b…22aa", value: "1,204" },
  { block: "52,910,098", pair: "NVDA / USDG", route: "0x551a…9be0 → 0x3c9f…f7e1", value: "860" },
  { block: "52,910,091", pair: "AAPL / USDG", route: "0x3f1a…77c2 → 0x8f3e…c41d", value: "100" },
  { block: "52,910,083", pair: "TSLA / USDG", route: "0x9c2d…e05b → 0x551a…9be0", value: "3,412" },
];

function VaultPreview(): ReactElement {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Example TVL (USDG)" value="$1,240,500" />
        <Metric label="Example APY" value="8.4%" />
        <div className="rounded-lg border border-line p-3">
          <p className="mono-label !text-[10px]">Collateral ratio</p>
          <p className="display mt-1 text-[16px] text-ink sm:text-[20px]">150%</p>
          <p className="mt-0.5 font-mono text-[9.5px] text-hood-deep">Example collateral reading</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between">
          <span className="mono-label !text-[10px]">Amount</span>
          <span className="font-mono text-[13px] text-ink">1,000 USDG</span>
        </div>
        <div className="mt-3 grid h-11 place-items-center rounded-lg bg-hood text-[14px] font-semibold text-black">
          Stake &amp; Yield
        </div>
      </div>

      <ol className="mt-4 flex flex-col gap-1.5 font-mono text-[12px] leading-5 text-ink-soft">
        <li className="fr-item" style={{ animationDelay: "0.15s" }}>
          <span className="text-hood-deep">✓</span> Oracle price feed synced
        </li>
        <li className="fr-item" style={{ animationDelay: "0.35s" }}>
          <span className="text-hood-deep">✓</span> Foundry strategy test passed
        </li>
        <li className="fr-item flex items-center gap-2" style={{ animationDelay: "0.55s" }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hood" />
          0x3f1… deposited 100 AAPL
        </li>
      </ol>
    </div>
  );
}

function IndexerPreview(): ReactElement {
  return (
    <div className="overflow-hidden rounded-lg bg-zinc-950">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-2">
        <p className="font-mono text-[11px] text-white/60">stream · /api/v1/events</p>
        <p className="font-mono text-[10px] text-hood">Illustrative stream</p>
      </div>
      <div className="flex flex-col gap-1.5 overflow-x-auto p-3.5 font-mono text-[11px] leading-5">
        {LOG_LINES.map(function row(line, index) {
          return (
            <p key={line.block} className="fr-item whitespace-nowrap" style={{ animationDelay: `${0.1 + index * 0.12}s` }}>
              <span className="text-white/35">{line.block}</span>{" "}
              <span className="text-hood">Transfer</span>
              <span className="text-white/50">(from, to, value)</span>{" "}
              <span className="text-white/70">{line.pair}</span>{" "}
              <span className="text-white/40">{line.route}</span>{" "}
              <span className="text-white/85">{line.value}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function WatcherPreview(): ReactElement {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hood" />
          <p className="mono-label !text-[10px]">Daemon</p>
        </div>
        <p className="mt-3 font-mono text-[14px] text-ink">Block #52,909,878</p>
        <p className="mt-1 font-mono text-[11px] text-ink-soft">checked · 0ms lag</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-panel">
          <div className="h-full w-full rounded-full bg-hood/70" />
        </div>
      </div>

      <div className="rounded-xl border border-line p-4">
        <p className="mono-label !text-[10px]">Telegram</p>
        <div className="fr-item mt-2.5 rounded-2xl rounded-tl-md bg-panel px-3.5 py-2.5" style={{ animationDelay: "0.25s" }}>
          <p className="text-[13px] leading-5 text-ink">
            <span className="font-semibold">WHALE ALERT:</span> 42,900 AAPL transfer detected above $10,000 threshold
          </p>
          <p className="mt-1 text-right font-mono text-[10px] text-ink-faint">now</p>
        </div>
      </div>
    </div>
  );
}

function previewFor(id: string): ReactElement {
  if (id === "indexer") {
    return <IndexerPreview />;
  }
  if (id === "watcher") {
    return <WatcherPreview />;
  }
  return <VaultPreview />;
}

export function DefiDemos(): ReactElement {
  return (
    <DemoShowcase
      sectionId="defi-demos"
      eyebrow="beyond pages"
      lead="Complex DeFi logic"
      trail="and event automation."
      deck="Deploy custom yield vaults, real-time indexers, and background daemons that run 24/7 on Robinhood Chain."
      demos={DEMOS}
      renderPreview={previewFor}
    />
  );
}
