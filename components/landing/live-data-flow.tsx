"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { Check } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// How the live data works, as motion: blocks arrive from the chain at the top,
// each one is checked against the registry in the middle, and what passes lands
// in the chart and the alert at the bottom. One beat per block, slow enough to
// read; the real chain is a block every 100 ms and the counter says so. The
// series is a fixed loop, so the chart is the same for everyone and never
// pretends to be a quote.

const BEAT_MS = 1600;
const BLOCKS_SHOWN = 4;
const POINTS_SHOWN = 18;
const START_BLOCK = 52_909_651;

const SERIES = [38, 41, 40, 44, 47, 45, 49, 53, 51, 56, 58, 55, 60, 64, 62, 67, 65, 70, 73, 71, 76, 74, 79, 83];

const TOKENS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "META", "GOOGL", "USDG"];

const CHECKS = ["name, symbol, decimals read from the contract", "issuer contract known", "holders and supply updated"];

interface Block {
  number: number;
  token: string;
  transfers: number;
  large: boolean;
}

function blockAt(tick: number): Block {
  return {
    number: START_BLOCK + tick,
    token: TOKENS[tick % TOKENS.length],
    transfers: 1 + ((tick * 7) % 5),
    large: tick % 6 === 4,
  };
}

function seriesAt(tick: number): number[] {
  const points: number[] = [];
  for (let i = POINTS_SHOWN - 1; i >= 0; i -= 1) {
    const index = tick - i;
    points.push(index < 0 ? SERIES[0] : SERIES[index % SERIES.length]);
  }
  return points;
}

// The series runs 38..83; drawn against that range, not 0..100, so the line
// uses the chart's height instead of hugging its floor.
const SERIES_MIN = 30;
const SERIES_MAX = 90;

function chartY(value: number, height: number): number {
  return height - ((value - SERIES_MIN) / (SERIES_MAX - SERIES_MIN)) * height;
}

function chartPath(points: number[], width: number, height: number): string {
  const step = width / (points.length - 1);
  return points
    .map(function segment(value, i) {
      return `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)} ${chartY(value, height).toFixed(1)}`;
    })
    .join(" ");
}

function formatBlock(number: number): string {
  return number.toLocaleString("en-US");
}

const CHART_W = 320;
const CHART_H = 90;

export function LiveDataFlow() {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef, { amount: 0.35 });
  const reduced = usePrefersReducedMotion();
  const running = inView && !reduced;
  const [tick, setTick] = useState(BLOCKS_SHOWN);
  const [checked, setChecked] = useState(CHECKS.length);
  const [headBlock, setHeadBlock] = useState(START_BLOCK + BLOCKS_SHOWN);

  useEffect(
    function beat() {
      if (!running) {
        return;
      }
      const timer = window.setInterval(function next() {
        setTick(function bump(current) {
          return current + 1;
        });
        setChecked(0);
      }, BEAT_MS);
      return function stop() {
        window.clearInterval(timer);
      };
    },
    [running],
  );

  // The checks run inside the beat, one after another, so the middle card is
  // seen doing work between one block and the next.
  useEffect(
    function runChecks() {
      if (!running || checked >= CHECKS.length) {
        return;
      }
      const timer = window.setTimeout(function next() {
        setChecked(checked + 1);
      }, BEAT_MS / 5);
      return function stop() {
        window.clearTimeout(timer);
      };
    },
    [running, checked],
  );

  useEffect(
    function countHead() {
      if (!running) {
        return;
      }
      const timer = window.setInterval(function next() {
        setHeadBlock(function bump(current) {
          return current + 1;
        });
      }, 100);
      return function stop() {
        window.clearInterval(timer);
      };
    },
    [running],
  );

  const blocks: Block[] = [];
  for (let i = BLOCKS_SHOWN - 1; i >= 0; i -= 1) {
    blocks.push(blockAt(tick - i));
  }
  const latest = blocks[blocks.length - 1];
  const points = seriesAt(tick);
  const path = chartPath(points, CHART_W, CHART_H);
  const lastY = chartY(points[points.length - 1], CHART_H);
  const alertBlock = blocks.find(function isLarge(block) {
    return block.large;
  });

  return (
    <div ref={hostRef} className="relative w-full max-w-[520px] font-mono text-[12px] text-white/70">
      <div className="pointer-events-none absolute inset-x-[10%] top-[30%] h-[50%] rounded-[100%] bg-[radial-gradient(closest-side,rgba(120,200,70,0.22),rgba(40,90,30,0.08)_55%,transparent_75%)] blur-2xl" />

      <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-white/45">
          <span>Robinhood Chain · 4663</span>
          <span className="flex items-center gap-2 normal-case tracking-normal text-white/60">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hood" />
            head {formatBlock(headBlock)}
          </span>
        </div>
        <ul className="mt-3 grid grid-cols-4 gap-2">
          {blocks.map(function renderBlock(block) {
            return (
              <motion.li
                key={block.number}
                layout
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.45, ease: "easeOut" }}
                className={`min-w-0 rounded-lg border px-2.5 py-2 ${
                  block.large ? "border-hood/60 bg-hood/10" : "border-white/10 bg-night"
                }`}
              >
                <p className="truncate text-[11px] text-white/45">#{formatBlock(block.number)}</p>
                <p className="mt-1 text-[12.5px] text-white">
                  {block.transfers} {block.token}
                </p>
                <p className="text-[10.5px] text-white/45">transfer{block.transfers === 1 ? "" : "s"}</p>
              </motion.li>
            );
          })}
        </ul>
      </div>

      <Connector />

      <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-white/45">
          <span>Fletch checks it</span>
          <span className="normal-case tracking-normal text-white/60">{latest.token} against the registry</span>
        </div>
        <ul className="mt-3 space-y-1.5">
          {CHECKS.map(function renderCheck(label, index) {
            const done = index < checked;
            return (
              <li key={label} className="flex items-center gap-2.5">
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-full border transition-colors duration-300 ${
                    done ? "border-hood bg-hood text-black" : "border-white/20 text-transparent"
                  }`}
                >
                  <Check className="h-2.5 w-2.5" strokeWidth={3} />
                </span>
                <span className={`transition-colors duration-300 ${done ? "text-white" : "text-white/40"}`}>{label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      <Connector />

      <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-white/45">
          <span>Your app</span>
          <span className="normal-case tracking-normal text-white/60">{latest.token} holders, live</span>
        </div>
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="mt-3 h-auto w-full overflow-visible" aria-hidden="true">
          <defs>
            <linearGradient id="live-data-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="rgb(0 200 5)" stopOpacity="0.35" />
              <stop offset="1" stopColor="rgb(0 200 5)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <motion.path
            d={`${path} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z`}
            fill="url(#live-data-fill)"
            animate={{ d: `${path} L${CHART_W} ${CHART_H} L0 ${CHART_H} Z` }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          <motion.path
            d={path}
            fill="none"
            stroke="rgb(0 200 5)"
            strokeWidth={2}
            strokeLinejoin="round"
            animate={{ d: path }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
          <motion.circle
            cx={CHART_W}
            cy={lastY}
            r={4}
            fill="rgb(0 200 5)"
            animate={{ cy: lastY, scale: [1, 1.6, 1] }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        </svg>
        <div className="mt-3 flex min-h-[28px] items-center justify-between gap-3">
          <span className="text-white/45">block {formatBlock(latest.number)} · sequencer-confirmed</span>
          <AnimatePresence>
            {alertBlock ? (
              <motion.span
                key={alertBlock.number}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="inline-flex items-center gap-1.5 rounded-full border border-hood/50 bg-hood/10 px-2.5 py-1 text-[11px] text-hood"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-hood" />
                Telegram alert · large {alertBlock.token} transfer
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Connector() {
  return (
    <div aria-hidden="true" className="flex justify-center py-1.5">
      <span className="relative h-5 w-px bg-white/15">
        <motion.span
          className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-hood"
          animate={{ y: [0, 14, 14], opacity: [0, 1, 0] }}
          transition={{ duration: BEAT_MS / 1000, repeat: Infinity, ease: "linear" }}
        />
      </span>
    </div>
  );
}
