"use client";

import { useEffect, useState, type ReactElement } from "react";
import { DemoShowcase, Metric, type Demo } from "@/components/landing/demo-showcase";

// The first demo band: pages and tools a prompt produces. Previews live in this
// file; the shell (cards, browser frame, hero prefill) is shared in
// demo-showcase.tsx with the DeFi band.

const DEMOS: Demo[] = [
  {
    id: "launcher",
    badge: "Interactive dApp",
    title: "Token launch pages",
    body: "Describe a testnet token launch page with a trading curve and wallet actions. Review the generated contract and test the trade flow before publishing.",
    prompt: "A Pump-style launch page on Robinhood Chain: ticker, USDG curve, progress bar, and a buy button.",
    address: "pump-aapl.apps.fletch.now",
  },
  {
    id: "tracker",
    badge: "Analytics",
    title: "Token trackers",
    body: "Build a dashboard from recorded token activity. Show the source and age of each reading, with missing data clearly marked.",
    prompt: "A public tracker page for a token: holder distribution, live price chart, and wallet flows read from on-chain state.",
    address: "tracker.apps.fletch.now",
  },
  {
    id: "game",
    badge: "Interactive dApp",
    title: "On-chain games",
    body: "Describe a game whose moves are signed transactions. Fletch builds the contract and interface on testnet so you can play through the rules before publishing.",
    prompt: "An on-chain territory game on Robinhood Chain: a tile board, wallet players, a prize pool, and a claim territory button. Every move is a transaction and game state lives in the contract.",
    address: "lands.apps.fletch.now",
  },
];

const TRACKERS = [
  {
    pair: "NVDA / USDG",
    chart: "M0,150 L40,138 L80,142 L120,120 L160,126 L200,104 L240,112 L280,88 L320,96 L360,74 L400,82 L440,60 L480,68 L520,48 L560,54",
    holders: [
      { address: "0x8f3e…c41d", balance: "1,204,400", share: "8.4%" },
      { address: "0x551a…9be0", balance: "986,150", share: "6.9%" },
      { address: "0xd07b…22aa", balance: "640,020", share: "4.5%" },
      { address: "0x3c9f…f7e1", balance: "512,780", share: "3.6%" },
    ],
  },
  {
    pair: "WBTC / USDG",
    chart: "M0,132 L40,98 L80,121 L120,76 L160,109 L200,64 L240,92 L280,48 L320,80 L360,57 L400,96 L440,44 L480,69 L520,32 L560,51",
    holders: [
      { address: "0x72ab…19e4", balance: "41.2", share: "8.7%" },
      { address: "0x10ce…a832", balance: "28.7", share: "6.1%" },
      { address: "0x5b81…f093", balance: "21.4", share: "4.5%" },
      { address: "0xa3d9…6b20", balance: "16.8", share: "3.6%" },
    ],
  },
];

function useDemoBeat(milliseconds: number, length: number): readonly [number, (beat: number) => void] {
  const [beat, setBeat] = useState(0);
  useEffect(function animateDemo() {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setInterval> | undefined;
    function updateMotion(): void {
      clearInterval(timer);
      if (reducedMotion.matches) return;
      timer = setInterval(function advance() {
        if (reducedMotion.matches) return;
        setBeat(function next(current) { return (current + 1) % length; });
      }, milliseconds);
    }
    updateMotion();
    reducedMotion.addEventListener("change", updateMotion);
    return function stop() {
      clearInterval(timer);
      reducedMotion.removeEventListener("change", updateMotion);
    };
  }, [milliseconds, length]);
  return [beat, setBeat];
}

function LauncherPreview(): ReactElement {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3">
        <Metric label="Example market price" value="$184.20" />
        <div className="rounded-lg border border-line p-3">
          <p className="mono-label !text-[10px]">Bonding curve</p>
          <p className="display mt-1 text-[16px] text-ink sm:text-[20px]">74%</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel">
            <div className="h-full w-[74%] rounded-full bg-hood" />
          </div>
        </div>
        <Metric label="Example volume" value="$42,100 USDG" />
      </div>

      <div className="mt-4 rounded-xl border border-line p-4">
        <div className="flex items-center justify-between">
          <span className="mono-label !text-[10px]">Amount</span>
          <span className="font-mono text-[13px] text-ink">500 USDG</span>
        </div>
        <div className="mt-3 grid h-11 place-items-center rounded-lg bg-hood text-[14px] font-semibold text-black">
          Swap On-Chain
        </div>
      </div>

      <ol className="mt-4 flex flex-col gap-1.5 font-mono text-[12px] leading-5 text-ink-soft">
        <li className="fr-item" style={{ animationDelay: "0.15s" }}>
          <span className="text-hood-deep">✓</span> Contract compiled in Foundry
        </li>
        <li className="fr-item" style={{ animationDelay: "0.35s" }}>
          <span className="text-hood-deep">✓</span> Sandbox deployed
        </li>
        <li className="fr-item flex items-center gap-2" style={{ animationDelay: "0.55s" }}>
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hood" />
          0x7a2… bought 2,400 AAPL
        </li>
      </ol>
    </div>
  );
}

function TrackerPreview(): React.ReactElement {
  const [selected, selectTracker] = useDemoBeat(4_000, TRACKERS.length);
  const tracker = TRACKERS[selected];
  return (
    <div data-tracker-pair={tracker.pair}>
      <div role="group" aria-label="Demo tracker token" className="mb-3 flex gap-2">
        {TRACKERS.map(function choice(dataset, index) {
          const active = selected === index;
          return <button key={dataset.pair} type="button" aria-pressed={active} onClick={function select() { selectTracker(index); }} className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-colors ${active ? "border-hood/50 bg-hood-wash text-hood-deep" : "border-line text-ink-faint"}`}>{dataset.pair.split(" / ")[0]}</button>;
        })}
      </div>
      <div className="rounded-xl border border-line p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <p className="text-[14px] font-medium text-ink">{tracker.pair}</p>
          <p className="font-mono text-[11px] text-ink-faint">24h</p>
        </div>
        <svg viewBox="0 0 560 180" preserveAspectRatio="none" aria-hidden="true" className="h-36 w-full sm:h-40">
          <defs>
            <linearGradient id="fletch-demo-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00c805" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00c805" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[45, 90, 135].map(function gridline(y) {
            return <line key={y} x1="0" y1={y} x2="560" y2={y} stroke="rgba(22,38,26,0.08)" strokeWidth="1" />;
          })}
          <path d={`${tracker.chart} L560,180 L0,180 Z`} fill="url(#fletch-demo-area)" />
          <path d={tracker.chart} fill="none" stroke="#01760e" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <p className="text-[13px] font-medium text-ink">Top holders</p>
          <p className="font-mono text-[10.5px] text-ink-faint">balances from the token contract</p>
        </div>
        {tracker.holders.map(function row(holder, index) {
          return (
            <div
              key={holder.address}
              className={`fr-item motion-reduce:animate-none grid grid-cols-[1.4rem_1fr_auto_auto] items-baseline gap-3 px-4 py-2.5 ${index > 0 ? "border-t border-line" : ""}`}
              style={{ animationDelay: `${0.15 + index * 0.1}s` }}
            >
              <span className="font-mono text-[11px] text-ink-faint">{index + 1}</span>
              <span className="font-mono text-[12px] text-ink">{holder.address}</span>
              <span className="font-mono text-[12px] text-ink">{holder.balance}</span>
              <span className="font-mono text-[12px] text-hood-deep">{holder.share}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type Territory = "green" | "dark" | "light" | "neutral";

const INITIAL_TERRITORY: readonly Territory[] = [
  "green", "green", "green", "dark", "dark", "dark",
  "green", "green", "green", "dark", "dark", "dark",
  "green", "green", "light", "light", "light", "neutral",
  "neutral", "neutral", "light", "light", "neutral", "neutral",
  "neutral", "neutral", "neutral", "neutral", "neutral", "neutral",
];
const PLAYERS = {
  green: { address: "0x7a2b…", tile: "border-hood/40 bg-hood text-black" },
  dark: { address: "0x3f1c…", tile: "border-line bg-ink/40 text-ink" },
  light: { address: "0xb84d…", tile: "border-line bg-ink/20 text-ink" },
};
const MOVES: ReadonlyArray<{ tile: number; owner: keyof typeof PLAYERS; blocks: number }> = [
  { tile: 18, owner: "green", blocks: 18 },
  { tile: 17, owner: "dark", blocks: 23 },
  { tile: 22, owner: "light", blocks: 16 },
  { tile: 19, owner: "green", blocks: 21 },
  { tile: 23, owner: "dark", blocks: 19 },
  { tile: 28, owner: "light", blocks: 24 },
  { tile: 24, owner: "green", blocks: 17 },
  { tile: 29, owner: "dark", blocks: 22 },
  { tile: 27, owner: "light", blocks: 18 },
  { tile: 25, owner: "green", blocks: 23 },
];

function GamePreview(): React.ReactElement {
  const [beat] = useDemoBeat(3_000, MOVES.length + 1);
  const territories = [...INITIAL_TERRITORY];
  let block = 52_910_441;
  const feed = ["0x3f1… captured tile 9", "0x7a2… captured tile 14"];
  for (const move of MOVES.slice(0, beat)) {
    territories[move.tile] = move.owner;
    block += move.blocks;
    feed.push(`${PLAYERS[move.owner].address} captured tile ${move.tile + 1}`);
  }
  return (
    <div data-game-beat={beat}>
      <style>{`
        @keyframes fletch-game-capture { 0% { opacity: .45; } 50% { opacity: 1; } 100% { opacity: 1; } }
        @keyframes fletch-game-reset { from { opacity: .35; } to { opacity: 1; } }
        @media (prefers-reduced-motion: no-preference) {
          .fletch-game-capture { animation: fletch-game-capture 400ms ease-out; }
          .fletch-game-reset { animation: fletch-game-reset 400ms ease-out; }
        }
      `}</style>
      <div className="grid grid-cols-3 gap-3 [&_.display]:[overflow-wrap:anywhere]">
        <Metric label="Players" value="12" />
        <Metric label="Prize pool" value="1,850 USDG" />
        <div key={beat} data-game-pulse={beat > 0 ? "block" : undefined} className={beat > 0 ? "fletch-game-capture" : ""}><Metric label="Block" value={`#${block.toLocaleString("en-US")}`} /></div>
      </div>
      <div key={beat === 0 ? "reset" : "playing"} role="img" aria-label="Demo territory board, 6 columns and 5 rows" className={`mx-auto mt-4 grid max-w-[360px] grid-cols-6 gap-1.5 rounded-xl border border-line p-3 ${beat === 0 ? "fletch-game-reset" : ""}`}>
        {territories.map(function tile(owner, index) {
          const color = owner === "neutral" ? "border-line bg-panel text-ink-faint" : PLAYERS[owner].tile;
          const captured = MOVES[beat - 1]?.tile === index;
          return <div key={`${index}-${owner}`} aria-hidden="true" data-tile-owner={owner} data-game-pulse={captured ? "tile" : undefined} className={`${captured ? "fletch-game-capture" : ""} grid aspect-square place-items-center rounded-md border font-mono text-[10px] motion-safe:transition-colors motion-safe:duration-500 ${color}`}>{index + 1}</div>;
        })}
      </div>
      <div className="mt-4 grid h-11 place-items-center rounded-lg bg-hood text-[14px] font-semibold text-black">Claim territory</div>
      <ol className="mt-4 flex flex-col gap-1.5 font-mono text-[12px] leading-5 text-ink-soft">
        <li><span className="text-hood-deep">✓</span> Move compiled and confirmed</li>
        {feed.slice(-2).reverse().map(function activity(line, index) {
          const latest = beat > 0 && index === 0;
          return <li key={line} data-game-pulse={latest ? "feed" : undefined} className={latest ? "fletch-game-capture" : ""}>{line}</li>;
        })}
      </ol>
    </div>
  );
}

function previewFor(id: string): ReactElement {
  if (id === "tracker") {
    return <TrackerPreview />;
  }
  if (id === "game") {
    return <GamePreview />;
  }
  return <LauncherPreview />;
}

export function BuildDemos(): ReactElement {
  return (
    <DemoShowcase
      sectionId="demos"
      eyebrow="see the output"
      lead="Apps you build in seconds"
      trail="that keep running."
      deck="Build a page or a tool from a prompt: token launchers, live trackers, and on-chain games."
      demos={DEMOS}
      renderPreview={previewFor}
    />
  );
}
