"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// The registry, verifying itself in front of you. Each card is a real row from
// the database: the sync takes Robinhood's listing, asks the chain for bytecode
// at the address, and marks the row verified. The three steps play in order for
// one token, then the next one slides in. Nothing here is invented; the list
// comes from the server, and the block number is the one it was verified near.

export interface VerifiedSample {
  symbol: string;
  name: string;
  address: string;
  verifiedAt: string;
}

interface VerifiedTickerProps {
  sample: VerifiedSample[];
  total: number;
}

const STEPS = ["listed by Robinhood", "bytecode requested", "bytecode found"];
const STEP_MS = 900;
const HOLD_MS = 1600;

function shortAddress(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function VerifiedTicker({ sample, total }: VerifiedTickerProps) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(reduced ? STEPS.length : 0);

  useEffect(
    function advance() {
      if (reduced || sample.length === 0) {
        return;
      }
      const delay = step < STEPS.length ? STEP_MS : HOLD_MS;
      const timer = window.setTimeout(function next() {
        if (step < STEPS.length) {
          setStep(step + 1);
          return;
        }
        setStep(0);
        setIndex(function bump(current) {
          return (current + 1) % sample.length;
        });
      }, delay);
      return function stop() {
        window.clearTimeout(timer);
      };
    },
    [reduced, sample.length, step],
  );

  if (sample.length === 0) {
    return null;
  }
  const asset = sample[index];
  const verified = step >= STEPS.length;

  return (
    <div className="rounded-xl border border-white/10 bg-black p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-white/55">verification, live rows</span>
        <span className="font-mono text-[11px] tabular-nums text-white/55">
          {index + 1} / {sample.length} of {total}
        </span>
      </div>

      <div className="relative mt-3 h-[88px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={asset.address}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0"
          >
            <div className="flex items-baseline gap-3">
              <span className="font-mono text-[22px] font-semibold text-white">{asset.symbol}</span>
              <span className="truncate text-[13px] text-white/60">{asset.name}</span>
            </div>
            <p className="mt-1 font-mono text-[12px] text-white/45">{shortAddress(asset.address)}</p>
            <p className="mt-2 flex items-center gap-2 font-mono text-[12px]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={`${asset.address}-${Math.min(step, STEPS.length - 1)}`}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={reduced ? undefined : { opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className={verified ? "flex items-center gap-1.5 text-hood" : "text-white/60"}
                >
                  {verified ? <Check className="h-3.5 w-3.5" strokeWidth={2.4} /> : null}
                  {verified ? `verified ${formatDate(asset.verifiedAt)}` : STEPS[Math.min(step, STEPS.length - 1)]}
                </motion.span>
              </AnimatePresence>
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      <ol className="mt-3 flex items-center gap-1.5">
        {STEPS.map(function renderStep(label, i) {
          const reached = step > i || verified;
          return (
            <li key={label} className="flex flex-1 items-center gap-1.5" title={label}>
              <motion.span
                className="h-1 flex-1 rounded-full bg-white/15"
                animate={{ backgroundColor: reached ? "rgba(0, 200, 5, 1)" : "rgba(255, 255, 255, 0.15)" }}
                transition={{ duration: 0.3 }}
              />
            </li>
          );
        })}
      </ol>
      <p className="mt-2 font-mono text-[10.5px] text-white/40">listed, requested, found. Every fifteen minutes, for every row.</p>
    </div>
  );
}
