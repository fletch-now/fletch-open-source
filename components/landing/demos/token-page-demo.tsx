"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, animate, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// One on-chain Transfer per tick; every UI change downstream is derived from it.
const TRANSFERS = [
  { from: "0x7a2f…9c41", to: "0x3b9e…d210", amount: 1200, block: 6_994_112, holder: 1 },
  { from: "0x51c0…e8aa", to: "0x7a2f…9c41", amount: 640, block: 6_994_113, holder: 0 },
  { from: "0x3b9e…d210", to: "0xa04d…77f3", amount: 2150, block: 6_994_115, holder: 3 },
];
const PRICES = [0.0421, 0.0437, 0.0429, 0.0452];
const HOLDERS = [
  { addr: "0x7a2f…9c41", base: 48_200 },
  { addr: "0x3b9e…d210", base: 31_650 },
  { addr: "0x51c0…e8aa", base: 19_400 },
  { addr: "0xa04d…77f3", base: 12_075 },
];
// The first BASE_POINTS draw on settle; the rest arrive one segment per tick.
const SERIES = [38, 34, 36, 31, 29, 33, 30, 32, 27, 30, 24];
const BASE_POINTS = 8;
const PHASE_OFFSETS = [0, 400, 900, 1300, 1650];
const TICK_MS = 1800;
const SETTLE_MS = 1600;
const FINAL_STEP = TRANSFERS.length * PHASE_OFFSETS.length - 1;

function pointAt(i: number): { x: number; y: number } {
  return { x: i * (300 / (SERIES.length - 1)), y: SERIES[i] };
}

function pathBetween(start: number, end: number): string {
  return SERIES.slice(start, end)
    .map((_, i) => `${i === 0 ? "M" : "L"}${pointAt(start + i).x} ${pointAt(start + i).y}`)
    .join(" ");
}

function TickingPrice({ value, animated }: { value: number; animated: boolean }): React.JSX.Element {
  const [shown, setShown] = useState(value);
  const prev = useRef(value);
  useEffect(
    function tick() {
      if (!animated) {
        prev.current = value;
        // Next frame, not synchronously: a setState in the effect body cascades.
        const frame = requestAnimationFrame(function settle() {
          setShown(value);
        });
        return () => cancelAnimationFrame(frame);
      }
      const controls = animate(prev.current, value, { duration: 0.55, ease: "easeOut", onUpdate: setShown });
      prev.current = value;
      return () => controls.stop();
    },
    [value, animated],
  );
  return <span className="font-mono text-lg font-semibold tabular-nums text-ink">${shown.toFixed(4)}</span>;
}

function DeltaChip({ index }: { index: number }): React.JSX.Element {
  const delta = index === 0 ? 0 : (PRICES[index] - PRICES[index - 1]) / PRICES[index - 1];
  const up = delta > 0;
  const tone = up ? "bg-hood-wash text-hood-deep" : "bg-panel text-ink-soft";
  return (
    <motion.span
      key={index}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${tone}`}
    >
      {up ? "+" : ""}
      {(delta * 100).toFixed(1)}%
    </motion.span>
  );
}

export function TokenPageDemo({ active }: { active: boolean }): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);

  useEffect(
    function schedule() {
      if (!active || reduced) return;
      const timers: ReturnType<typeof setTimeout>[] = [];
      function loop(): void {
        setStep(-1);
        setRun((r) => r + 1);
        for (let s = 0; s <= FINAL_STEP; s += 1) {
          const tickIndex = Math.floor(s / PHASE_OFFSETS.length);
          const at = SETTLE_MS + tickIndex * TICK_MS + PHASE_OFFSETS[s % PHASE_OFFSETS.length];
          timers.push(setTimeout(setStep, at, s));
        }
        timers.push(setTimeout(loop, SETTLE_MS + TRANSFERS.length * TICK_MS + 400));
      }
      loop();
      return () => timers.forEach(clearTimeout);
    },
    [active, reduced],
  );

  const animated = active && !reduced;
  const effectiveStep = reduced ? FINAL_STEP : step;
  const tick = effectiveStep < 0 ? -1 : Math.floor(effectiveStep / PHASE_OFFSETS.length);
  const phase = effectiveStep < 0 ? -1 : effectiveStep % PHASE_OFFSETS.length;
  const priceIndex = tick < 0 ? 0 : tick + (phase >= 1 ? 1 : 0);
  const segments = tick < 0 ? 0 : tick + (phase >= 2 ? 1 : 0);
  const applied = tick < 0 ? 0 : tick + (phase >= 3 ? 1 : 0);
  const event = tick >= 0 && phase <= 3 ? TRANSFERS[tick] : null;
  const flashing = phase === 3 ? TRANSFERS[tick].holder : -1;
  // Every segment but the newest is folded into the settled path so only one line ever draws.
  const settledCount = BASE_POINTS + Math.max(segments - 1, 0);
  const head = pointAt(BASE_POINTS - 1 + segments);
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5 };

  return (
    <div className="relative h-full w-full overflow-hidden bg-paper p-3">
      <motion.div
        key={run}
        initial={animated ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex h-full flex-col rounded-lg border border-line bg-raised shadow-sm"
      >
        <div className="flex items-center gap-1.5 border-b border-line px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-panel ring-1 ring-line" />
          <span className="h-1.5 w-1.5 rounded-full bg-panel ring-1 ring-line" />
          <span className="ml-1.5 font-mono text-[9px] text-ink-faint">xyz.example/token</span>
        </div>

        <div className="flex items-start justify-between px-3 pt-2">
          <div>
            <div className="text-sm font-semibold text-ink">XYZ</div>
            <div className="mono-label">Public token page</div>
          </div>
          <div className="flex items-center gap-1.5">
            <TickingPrice value={PRICES[priceIndex]} animated={animated} />
            <AnimatePresence mode="popLayout" initial={false}>
              <DeltaChip index={priceIndex} />
            </AnimatePresence>
          </div>
        </div>

        <svg viewBox="0 0 300 48" preserveAspectRatio="none" className="mx-3 mt-1 h-11 w-auto">
          <motion.path
            key={`base-${run}`}
            d={pathBetween(0, settledCount)}
            {...stroke}
            className="text-ink-soft"
            initial={animated ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />
          {segments > 0 && (
            <motion.path
              key={`seg-${run}-${segments}`}
              d={pathBetween(settledCount - 1, settledCount + 1)}
              {...stroke}
              className="text-hood-deep"
              initial={animated ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
            />
          )}
          <motion.circle r="2.5" className="fill-hood" animate={{ cx: head.x, cy: head.y }} transition={{ duration: 0.45 }} />
        </svg>

        <ul className="mt-1.5 flex-1 px-3">
          <li className="mono-label pb-0.5">Top holders</li>
          {HOLDERS.map(function row(h, i) {
            const balance = TRANSFERS.slice(0, applied).reduce((sum, t) => (t.holder === i ? sum + t.amount : sum), h.base);
            const isFlashing = flashing === i;
            return (
              <motion.li
                key={`${run}-${h.addr}`}
                initial={animated ? { opacity: 0, x: -4 } : false}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.14, duration: 0.3 }}
                className={`flex items-center justify-between rounded px-1 py-[3px] font-mono text-[10px] transition-colors duration-300 ${isFlashing ? "bg-hood-wash" : "bg-transparent"}`}
              >
                <span className="text-ink-faint">{i + 1}</span>
                <span className="flex-1 pl-2 text-ink-soft">{h.addr}</span>
                <span className={`tabular-nums ${isFlashing ? "text-hood-deep" : "text-ink"}`}>{balance.toLocaleString("en-US")}</span>
              </motion.li>
            );
          })}
        </ul>

        {/* The event line lands before any UI reacts: the page is a view of the chain. */}
        <div className="h-5 border-t border-line px-3">
          <AnimatePresence initial={false}>
            {event && (
              <motion.div
                key={event.block}
                initial={animated ? { opacity: 0 } : false}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-2 py-1 font-mono text-[9px] leading-none"
              >
                <span className="text-ink-faint">#{event.block.toLocaleString("en-US")}</span>
                <span className="text-hood-deep">
                  Transfer({event.from}, {event.to}, {event.amount})
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
