"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// The watcher as a picture of what it does: blocks arrive from the chain ten times a
// second, each transfer is carried to the daemon, the daemon compares it with the
// threshold, and only the ones above it travel on to Telegram. The rest stop at the
// daemon and fade — that is the point of a threshold, so it is shown, not implied.
// Numbers are placeholders and the strip says so.

interface Transfer {
  symbol: string;
  amount: string;
  above: boolean;
}

const THRESHOLD = "250,000 AAPL";

// Scripted so the sequence reads: two ignored, one sent, one ignored, one sent.
const TRANSFERS: Transfer[] = [
  { symbol: "AAPL", amount: "12,400", above: false },
  { symbol: "AAPL", amount: "88,050", above: false },
  { symbol: "AAPL", amount: "1,250,000", above: true },
  { symbol: "AAPL", amount: "3,900", above: false },
  { symbol: "AAPL", amount: "640,000", above: true },
];

const CYCLE_MS = 4200;

interface PacketPath {
  animate: { left: string | string[]; opacity: number | number[] };
  times?: number[];
}

// Where the packet goes: to Telegram if it clears the threshold, otherwise it stops
// at the daemon and fades. Still when not running.
function packetPath(running: boolean, above: boolean): PacketPath {
  if (!running) {
    return { animate: { left: "50%", opacity: 1 } };
  }
  if (above) {
    return { animate: { left: ["16%", "50%", "50%", "84%"], opacity: [0, 1, 1, 1] }, times: [0, 0.4, 0.55, 0.9] };
  }
  return { animate: { left: ["16%", "50%", "50%"], opacity: [0, 1, 0] }, times: [0, 0.45, 1] };
}

export function WatchFlow({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [block, setBlock] = useState(52_000_834);
  const [step, setStep] = useState(0);
  const [sent, setSent] = useState(0);
  const running = active && !reduced;

  // Robinhood Chain blocks land every 100 ms; the counter runs at that rate so the
  // scale of "watching every block" is felt rather than read.
  useEffect(
    function tickBlocks() {
      if (!running) {
        return;
      }
      const timer = window.setInterval(function next() {
        setBlock(function bump(current) {
          return current + 1;
        });
      }, 100);
      return function stop() {
        window.clearInterval(timer);
      };
    },
    [running],
  );

  useEffect(
    function advance() {
      if (!running) {
        return;
      }
      const timer = window.setTimeout(function next() {
        setStep(function bump(current) {
          return (current + 1) % TRANSFERS.length;
        });
      }, CYCLE_MS);
      return function stop() {
        window.clearTimeout(timer);
      };
    },
    [running, step],
  );

  // Count a send when its packet reaches Telegram, roughly two thirds of the way in.
  useEffect(
    function countSends() {
      if (!running || !TRANSFERS[step].above) {
        return;
      }
      const timer = window.setTimeout(function mark() {
        setSent(function bump(current) {
          return current + 1;
        });
      }, CYCLE_MS * 0.7);
      return function stop() {
        window.clearTimeout(timer);
      };
    },
    [running, step],
  );

  const transfer = TRANSFERS[step];
  const packet = packetPath(running, transfer.above);

  return (
    <div className="overflow-hidden rounded-card border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="mono-label">how a watcher runs</span>
        <span className="ml-auto font-mono text-[11px] text-ink-faint">threshold {THRESHOLD} · placeholder data</span>
      </div>

      <div className="relative px-4 pb-5 pt-6 sm:px-6">
        {/* The three stations. */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Station
            title="Robinhood Chain"
            caption={
              <span className="tabular-nums">
                block {block.toLocaleString()}
              </span>
            }
          >
            <motion.span
              className="block h-2.5 w-2.5 rounded-full bg-hood"
              animate={running ? { opacity: [1, 0.35, 1] } : { opacity: 1 }}
              transition={{ duration: 0.2, repeat: Infinity }}
            />
          </Station>
          <Station title="Fletch daemon" caption={`checkpoint ${(block - 20).toLocaleString()}`}>
            <span className="relative block h-2.5 w-2.5">
              <motion.span
                className="absolute inset-0 rounded-full bg-hood/50"
                animate={running ? { scale: [1, 2.6], opacity: [0.6, 0] } : { scale: 1, opacity: 0 }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeOut" }}
              />
              <span className="absolute inset-0 rounded-full bg-hood" />
            </span>
          </Station>
          <Station title="Telegram" caption={`${sent} sent`}>
            <span className="grid h-6 w-6 place-items-center rounded-full bg-hood text-black">
              <TelegramMark size={11} />
            </span>
          </Station>
        </div>

        {/* The wire, and the packet travelling it. */}
        <div className="relative mt-5 h-16">
          <div className="absolute inset-x-[16%] top-3 h-px bg-line" />
          <AnimatePresence initial={false}>
            <motion.div
              key={`${step}-${transfer.amount}`}
              className="absolute top-0 -translate-x-1/2"
              initial={{ left: "16%", opacity: 0 }}
              animate={packet.animate}
              exit={{ opacity: 0 }}
              transition={{ duration: CYCLE_MS / 1000, ease: "easeInOut", times: packet.times }}
            >
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] ${
                  transfer.above ? "bg-hood text-black" : "bg-panel text-ink-soft"
                }`}
              >
                {transfer.amount} {transfer.symbol}
              </span>
            </motion.div>
          </AnimatePresence>

          {/* The verdict, under the daemon. */}
          <AnimatePresence mode="wait">
            <motion.p
              key={`verdict-${step}`}
              className={`absolute left-1/2 top-9 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] ${
                transfer.above ? "text-hood-deep" : "text-ink-faint"
              }`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: running ? (CYCLE_MS / 1000) * 0.45 : 0, duration: 0.3 }}
            >
              {transfer.above ? "above threshold · send" : "below threshold · ignored"}
            </motion.p>
          </AnimatePresence>
        </div>

        <p className="mt-2 font-mono text-[10.5px] text-ink-faint">
          sequencer-confirmed · checkpoint kept every poll · rolls back on a reorg
        </p>
      </div>
    </div>
  );
}

interface StationProps {
  title: string;
  caption: ReactNode;
  children: ReactNode;
}

function Station({ title, caption, children }: StationProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="grid h-8 place-items-center">{children}</span>
      <span className="text-[12.5px] font-medium text-ink">{title}</span>
      <span className="font-mono text-[10.5px] text-ink-faint">{caption}</span>
    </div>
  );
}
