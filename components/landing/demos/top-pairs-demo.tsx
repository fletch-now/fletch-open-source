"use client";

import type React from "react";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

type Pair = {
  id: string;
  base: string;
  quote: string;
  volume: number;
};

type SwapEvent = {
  id: number;
  line: string;
  pairId: string;
};

const INITIAL_PAIRS: Pair[] = [
  { id: "xyz", base: "XYZ", quote: "ETH", volume: 184_200 },
  { id: "qrs", base: "QRS", quote: "ETH", volume: 152_900 },
  { id: "lmn", base: "LMN", quote: "USDX", volume: 121_400 },
  { id: "abc", base: "ABC", quote: "ETH", volume: 96_700 },
  { id: "def", base: "DEF", quote: "USDX", volume: 61_300 },
];

// Scripted so the reorder is guaranteed on every beat, rather than left to chance.
const SWAPS: Omit<SwapEvent, "id">[] = [
  { line: "Swap(0x7a2f…9c41, QRS→ETH, 48_400)", pairId: "qrs" },
  { line: "Swap(0x3b9e…d102, DEF→USDX, 72_100)", pairId: "def" },
  { line: "Swap(0xc41d…08ab, ABC→ETH, 39_800)", pairId: "abc" },
  { line: "Swap(0x9f00…e77c, LMN→USDX, 54_600)", pairId: "lmn" },
];

const SWAP_AMOUNTS = [48_400, 72_100, 39_800, 54_600];
const BEAT_MS = 2_000;
// Long enough for the mono line to register before the table answers it.
const EVENT_LEAD_MS = 450;

function formatVolume(volume: number): string {
  return volume.toLocaleString("en-US");
}

// The final composed state for reduced-motion viewers: every swap already applied.
function settledPairs(): Pair[] {
  const pairs = INITIAL_PAIRS.map(function clone(pair): Pair {
    return { ...pair };
  });
  SWAPS.forEach(function apply(swap, index): void {
    const pair = pairs.find(function match(candidate): boolean {
      return candidate.id === swap.pairId;
    });
    if (pair) pair.volume += SWAP_AMOUNTS[index];
  });
  return sortByVolume(pairs);
}

function sortByVolume(pairs: Pair[]): Pair[] {
  return [...pairs].sort(function desc(a, b): number {
    return b.volume - a.volume;
  });
}

export function TopPairsDemo({ active }: { active: boolean }): React.JSX.Element {
  const reduceMotion = usePrefersReducedMotion();
  const [pairs, setPairs] = useState<Pair[]>(INITIAL_PAIRS);
  const [event, setEvent] = useState<SwapEvent | null>(null);
  const [changedId, setChangedId] = useState<string | null>(null);

  useEffect(
    function runBeats(): () => void {
      if (!active || reduceMotion) {
        // Deferred by a tick: a synchronous setState here re-renders during commit.
        const settle = setTimeout(function rest() {
          setPairs(reduceMotion ? settledPairs() : INITIAL_PAIRS);
          setEvent(null);
          setChangedId(null);
        }, 0);
        return function cancel(): void {
          clearTimeout(settle);
        };
      }

      let step = 0;
      const timers: ReturnType<typeof setTimeout>[] = [];

      function beat(): void {
        const index = step % SWAPS.length;
        // Restarting from the seed each cycle keeps the bars from creeping off-scale.
        if (index === 0) setPairs(INITIAL_PAIRS);
        const swap = SWAPS[index];
        setEvent({ ...swap, id: step });

        timers.push(
          setTimeout(function applySwap(): void {
            setChangedId(swap.pairId);
            setPairs(function bump(previous): Pair[] {
              return sortByVolume(
                previous.map(function grow(pair): Pair {
                  if (pair.id !== swap.pairId) return pair;
                  return { ...pair, volume: pair.volume + SWAP_AMOUNTS[index] };
                }),
              );
            });
          }, EVENT_LEAD_MS),
        );
        step += 1;
      }

      beat();
      const interval = setInterval(beat, BEAT_MS);

      return function cleanup(): void {
        clearInterval(interval);
        timers.forEach(clearTimeout);
      };
    },
    [active, reduceMotion],
  );

  const maxVolume = Math.max(...pairs.map(function pick(pair): number {
    return pair.volume;
  }));

  return (
    <div className="relative h-full w-full overflow-hidden bg-raised p-4 text-ink">
      <div className="mb-2 flex items-center justify-between">
        <span className="mono-label">Top pairs · 24h volume</span>
        <span className="font-mono text-[10px] text-ink-faint">block 6,994,118</span>
      </div>

      <div className="mb-2 h-4 font-mono text-[10px] text-ink-faint">
        <AnimatePresence mode="wait">
          {event && (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="truncate text-hood-deep"
            >
              {event.line}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="relative">
        {/* Rank column lives outside the animated rows so the numbers never move. */}
        <div className="absolute inset-y-0 left-0 flex w-5 flex-col">
          {pairs.map(function rank(_pair, index): React.JSX.Element {
            return (
              <div key={index} className="flex h-8 items-center font-mono text-[11px] text-ink-faint">
                {index + 1}
              </div>
            );
          })}
        </div>

        <div className="ml-5 flex flex-col">
          {pairs.map(function row(pair): React.JSX.Element {
            const isChanged = pair.id === changedId;
            return (
              <motion.div
                key={pair.id}
                layout={!reduceMotion}
                transition={{ type: "spring", stiffness: 380, damping: 34 }}
                className="flex h-8 items-center gap-3 border-b border-line last:border-b-0"
              >
                <span className="w-20 shrink-0 font-mono text-[11px] text-ink">
                  {pair.base}
                  <span className="text-ink-faint"> / {pair.quote}</span>
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel">
                  <motion.div
                    className={isChanged ? "h-full rounded-full bg-hood" : "h-full rounded-full bg-current text-ink-soft"}
                    initial={false}
                    animate={{ width: `${(pair.volume / maxVolume) * 100}%` }}
                    transition={reduceMotion ? { duration: 0 } : { duration: 0.5, ease: "easeOut" }}
                  />
                </div>
                <span
                  className={
                    isChanged
                      ? "w-16 shrink-0 text-right font-mono text-[11px] text-hood-deep"
                      : "w-16 shrink-0 text-right font-mono text-[11px] text-ink-soft"
                  }
                >
                  {formatVolume(pair.volume)}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
