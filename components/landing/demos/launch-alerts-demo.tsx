"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

type Launch = {
  id: number;
  ticker: string;
  pair: string;
  event: string;
};

const START_BLOCK = 6_994_120;
const BEAT_MS = 750;
// Nine beats per loop yields three launches, then the feed resets.
const BEATS_PER_LOOP = 9;
// The event line lands before the card so the causality reads left to right.
const EVENT_LEAD_MS = 320;

const LAUNCHES: Launch[] = [
  { id: 0, ticker: "XYZ", pair: "WETH", event: "PairCreated(0x7a2f…9c41, 0x3b9e…d102, XYZ/WETH)" },
  { id: 1, ticker: "QRS", pair: "USDC", event: "PairCreated(0x51c0…8e7a, 0x3b9e…d102, QRS/USDC)" },
  { id: 2, ticker: "LMN", pair: "WETH", event: "PairCreated(0xe94d…22b6, 0x3b9e…d102, LMN/WETH)" },
];

export function LaunchAlertsDemo({ active }: { active: boolean }): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [beat, setBeat] = useState(0);
  const [found, setFound] = useState<Launch[]>([]);
  const [event, setEvent] = useState<string | null>(null);

  useEffect(() => {
    if (!active || reduced) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let tick = 0;
    // Deferred by a tick: a synchronous setState here re-renders during commit.
    timers.push(setTimeout(function reset() {
      setBeat(0);
      setFound([]);
      setEvent(null);
    }, 0));

    const interval = setInterval(() => {
      tick += 1;
      if (tick >= BEATS_PER_LOOP) {
        tick = 0;
        setFound([]);
        setEvent(null);
      }
      setBeat(tick);
      if (tick > 0 && tick % 3 === 0) {
        const launch = LAUNCHES[tick / 3 - 1];
        setEvent(launch.event);
        timers.push(
          setTimeout(() => {
            setFound((prev) => [launch, ...prev]);
          }, EVENT_LEAD_MS),
        );
      }
    }, BEAT_MS);

    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [active, reduced]);

  // The resting and reduced-motion frames both show the fully composed story.
  const showFinal = reduced || !active;
  const visibleBeat = showFinal ? BEATS_PER_LOOP - 1 : beat;
  const visibleFound = showFinal ? [...LAUNCHES].reverse() : found;
  const visibleEvent = showFinal ? LAUNCHES[2].event : event;
  const block = START_BLOCK + visibleBeat;
  const motionProps = reduced ? { transition: { duration: 0 } } : {};

  return (
    <div className="relative h-full w-full overflow-hidden bg-raised p-4 text-ink">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 font-mono text-xs text-ink-soft">
          <ScanDot active={active && !reduced} />
          <span className="mono-label">block</span>
          <span className="tabular-nums text-ink">{block.toLocaleString("en-US")}</span>
        </div>
        <FoundBadge count={visibleFound.length} />
      </div>

      <div className="mt-3 h-4 font-mono text-[10px] leading-4 text-ink-faint">
        <AnimatePresence mode="wait">
          {visibleEvent ? (
            <motion.div
              key={visibleEvent}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              {...motionProps}
              className="truncate"
            >
              <span className="text-hood-deep">event</span> {visibleEvent}
            </motion.div>
          ) : (
            <motion.div key="scanning" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              scanning mempool for PairCreated…
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {visibleFound.map((launch, index) => (
            <motion.div
              key={launch.id}
              layout
              initial={{ opacity: 0, x: 56 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
            >
              <LaunchCard launch={launch} fresh={index === 0} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function ScanDot({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span className="relative flex h-2 w-2">
      {active ? (
        <motion.span
          className="absolute inset-0 rounded-full bg-hood"
          animate={{ scale: [1, 2.2], opacity: [0.6, 0] }}
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeOut" }}
        />
      ) : null}
      <span className="relative h-2 w-2 rounded-full bg-hood" />
    </span>
  );
}

function FoundBadge({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-line bg-panel px-2 py-0.5 font-mono text-[10px] text-ink-soft">
      <motion.span key={count} initial={{ scale: 1.4 }} animate={{ scale: 1 }} className="tabular-nums text-ink">
        {count}
      </motion.span>
      <span>found</span>
    </div>
  );
}

function LaunchCard({ launch, fresh }: { launch: Launch; fresh: boolean }): React.JSX.Element {
  const ring = fresh ? "ring-1 ring-hood/25 bg-hood-wash" : "bg-panel";
  return (
    <div className={`flex items-center justify-between rounded-md border border-line px-3 py-2 ${ring}`}>
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-raised font-mono text-[10px] text-ink">
          {launch.ticker.slice(0, 1)}
        </div>
        <div className="leading-tight">
          <div className="font-mono text-xs text-ink">
            {launch.ticker}
            <span className="text-ink-faint"> / {launch.pair}</span>
          </div>
          <div className="text-[10px] text-ink-faint">new pair · liquidity added</div>
        </div>
      </div>
      <div className={fresh ? "text-[10px] text-hood-deep" : "text-[10px] text-ink-faint"}>just now</div>
    </div>
  );
}
