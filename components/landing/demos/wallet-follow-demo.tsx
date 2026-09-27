"use client";

import { useEffect, useState } from "react";
import type React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

const WALLET = "0x7a2f…9c41";
const COUNTERPARTY = "0x3b9e…41d2";
const POOL = [
  { ticker: "XYZ", price: "0.0421" },
  { ticker: "QRS", price: "1.2040" },
  { ticker: "ABQ", price: "0.0087" },
  { ticker: "LMN", price: "3.1150" },
  { ticker: "PDX", price: "0.5602" },
  { ticker: "KJW", price: "0.0013" },
];
const MAX_ROWS = 4;
const ROW_STEP = 30;
const CYCLE_MS = 7200;

interface Holding { id: number; ticker: string; price: string; sold: boolean }
type Phase = "idle" | "event" | "pulse" | "travel" | "docked" | "sold";

// The reduced-motion frame and the pre-loop frame both start from here.
const RESTING: Holding[] = [
  { id: 0, ticker: "XYZ", price: "0.0421", sold: false },
  { id: 1, ticker: "QRS", price: "1.2040", sold: true },
  { id: 2, ticker: "ABQ", price: "0.0087", sold: false },
];

function pick(n: number): Holding {
  return { id: n + 100, ...POOL[n % POOL.length], sold: false };
}

function markFirstSold(rows: Holding[]): Holding[] {
  const target = rows.find((r) => !r.sold);
  return rows.map((r) => (r === target ? { ...r, sold: true } : r));
}

export function WalletFollowDemo({ active }: { active: boolean }): React.JSX.Element {
  const still = usePrefersReducedMotion();
  const [holdings, setHoldings] = useState<Holding[]>(RESTING);
  const [phase, setPhase] = useState<Phase>("idle");
  const [event, setEvent] = useState<string | null>(null);
  const [traveling, setTraveling] = useState<Holding | null>(null);

  useEffect(() => {
    if (still || !active) {
      // Deferred by a tick: a synchronous setState here re-renders during commit.
      // Also never leaves a chip frozen mid-flight when the card scrolls away.
      const settle = window.setTimeout(function rest() {
        setPhase("idle");
        setTraveling(null);
        if (still) {
          setHoldings(RESTING);
          setEvent(`Swap(${WALLET}, ABQ, 1200)`);
        } else {
          setEvent(null);
        }
      }, 0);
      return () => window.clearTimeout(settle);
    }
    const timers: number[] = [];
    function at(ms: number, fn: () => void): void {
      timers.push(window.setTimeout(fn, ms));
    }
    function runCycle(n: number): void {
      const next = pick(n);
      const amount = ((n * 731 + 1200) % 9000) + 400;
      at(500, () => {
        setEvent(`Swap(${WALLET}, ${next.ticker}, ${amount})`);
        setPhase("event");
      });
      at(900, () => setPhase("pulse"));
      at(1200, () => {
        setTraveling(next);
        setPhase("travel");
      });
      at(2100, () => {
        setHoldings((rows) => [...rows.slice(-(MAX_ROWS - 1)), next]);
        setTraveling(null);
        setPhase("docked");
      });
      at(3300, () => setEvent(null));
      // Every third cycle the wallet exits a position, so the list also shrinks.
      if (n % 3 === 2) {
        at(4200, () => setEvent(`Transfer(${WALLET}, ${COUNTERPARTY}, ${amount})`));
        at(4800, () => {
          setHoldings(markFirstSold);
          setPhase("sold");
        });
        at(6200, () => setEvent(null));
      }
      at(CYCLE_MS, () => runCycle(n + 1));
    }
    runCycle(0);
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [active, still]);

  const held = holdings.filter((h) => !h.sold).length;
  const dockIndex = Math.min(holdings.length, MAX_ROWS - 1);
  const pulsing = phase === "pulse" || phase === "travel";
  const newest = holdings[holdings.length - 1];

  return (
    <div className="relative h-full w-full overflow-hidden">
      <span className="mono-label absolute left-4 top-3">watching</span>
      <span className="mono-label absolute right-4 top-3">
        bought ·{" "}
        <motion.span key={held} className="inline-block text-ink" initial={{ scale: 1.4 }} animate={{ scale: 1 }}>
          {held}
        </motion.span>
      </span>

      {/* Flight path — an ellipse's top edge stands in for an arc without SVG colour classes. */}
      <div className="absolute left-[44px] top-[10px] h-[48px] w-[164px] rounded-[50%] border-t border-dashed border-line-strong" />

      <div className="absolute left-4 top-9 flex items-center gap-2 rounded-full border border-line bg-panel py-1.5 pl-1.5 pr-3">
        <span className="relative h-6 w-6 rounded-full bg-hood-wash ring-2 ring-line">
          <span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-hood" />
          <AnimatePresence>
            {pulsing && (
              <motion.span
                className="absolute inset-0 rounded-full ring-2 ring-hood/25"
                initial={{ scale: 1, opacity: 1 }}
                animate={{ scale: 2.8, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.9, ease: "easeOut" }}
              />
            )}
          </AnimatePresence>
        </span>
        <span className="font-mono text-xs text-ink">{WALLET}</span>
      </div>

      <div className="absolute left-4 right-4 top-[84px] h-4">
        <AnimatePresence mode="wait">
          {event && (
            <motion.span
              key={event}
              className="block truncate font-mono text-[10px] text-hood-deep"
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: still ? 0 : 0.2 }}
            >
              {event}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {traveling && (
        <motion.div
          key={traveling.id}
          className="absolute left-[30px] top-[44px] rounded-full border border-line bg-raised px-2 py-0.5 font-mono text-[11px] text-ink ring-1 ring-hood/25"
          initial={{ x: 0, y: 0, scale: 0.8, opacity: 0 }}
          animate={{ x: [0, 90, 178], y: [0, -40, dockIndex * ROW_STEP - 8], scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease: "easeInOut", times: [0, 0.5, 1] }}
        >
          {traveling.ticker}
        </motion.div>
      )}

      <ul className="absolute right-4 top-9 w-[136px]">
        <AnimatePresence initial={false}>
          {holdings.map((row) => (
            <TokenRow
              key={row.id}
              row={row}
              justDocked={phase === "docked" && row === newest && !still}
              still={still}
            />
          ))}
        </AnimatePresence>
      </ul>
    </div>
  );
}

interface TokenRowProps {
  row: Holding;
  justDocked: boolean;
  still: boolean;
}

function TokenRow({ row, justDocked, still }: TokenRowProps): React.JSX.Element {
  const surface = justDocked ? "bg-hood-wash ring-1 ring-hood/25" : "bg-panel";
  const dim = row.sold ? "opacity-45" : "";
  return (
    <motion.li
      layout
      className={`mb-1 flex h-[26px] items-center justify-between rounded-full border border-line px-2.5 ${surface} ${dim}`}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: still ? 0 : 0.25 }}
    >
      <span className="font-mono text-xs text-ink">{row.ticker}</span>
      {row.sold ? (
        <span className="mono-label line-through">sold</span>
      ) : (
        <span className="font-mono text-[10px] text-ink-faint">{row.price}</span>
      )}
    </motion.li>
  );
}
