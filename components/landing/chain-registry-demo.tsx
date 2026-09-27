"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "framer-motion";
import { Check } from "@/components/ui/icons";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// The handoff, dramatised. A general-purpose agent guesses the chain's facts from its
// training data and gets them wrong in specific, predictable ways; Fletch hands it the
// verified registry before it writes a line. Each beat shows one guess struck out and
// the checked fact sliding into its place.

const FACTS = [
  { label: "chain id", guess: "1", truth: "4663" },
  { label: "explorer", guess: "etherscan.io", truth: "Robinhood Chain explorer" },
  { label: "gas token", guess: "RHC", truth: "ETH" },
  { label: "testnet", guess: "goerli", truth: "46630" },
  { label: "rpc", guess: "mainnet.infura.io", truth: "rpc.mainnet.chain.robinhood.com" },
];

// Long enough to read the strike-through before the correction arrives.
const BEAT_MS = 2200;

// components/ui/icons.tsx has no "wrong guess" glyph, so this is drawn locally
// in the set's own visual language (square caps, mitred joins) rather than
// pulling one more icon into the shared set for a single caller.
function WrongMark({ className, strokeWidth = 2.2 }: { className?: string; strokeWidth?: number }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      aria-hidden="true"
    >
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

type Stage = "guess" | "struck" | "fixed";

export function ChainRegistryDemo({ active }: { active: boolean }): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [stage, setStage] = useState<Stage>("guess");

  useEffect(
    function run() {
      if (!active || reduced) {
        return;
      }
      const timers: number[] = [];
      timers.push(window.setTimeout(function strike() { setStage("struck"); }, BEAT_MS * 0.35));
      timers.push(window.setTimeout(function fix() { setStage("fixed"); }, BEAT_MS * 0.6));
      timers.push(
        window.setTimeout(function next() {
          setStage("guess");
          setIndex(function bump(current) {
            return (current + 1) % FACTS.length;
          });
        }, BEAT_MS),
      );
      return function stop() {
        timers.forEach(function clear(id) {
          window.clearTimeout(id);
        });
      };
    },
    [active, reduced, index],
  );

  const settled = reduced || !active;
  const rows = FACTS.map(function rowState(fact, i) {
    // Everything before the current beat is already corrected; the current beat
    // walks through guess → struck → fixed; later rows still show the agent's guess.
    if (settled || i < index || (i === index && stage === "fixed")) {
      return { ...fact, state: "fixed" as const };
    }
    if (i === index && stage === "struck") {
      return { ...fact, state: "struck" as const };
    }
    return { ...fact, state: "guess" as const };
  });

  return (
    <div className="relative h-full w-full overflow-hidden rounded-card border border-line bg-raised">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="mono-label">what the agent knows</span>
        <span className="flex items-center gap-1.5 font-mono text-[10.5px] text-ink-faint">
          <span className="h-1.5 w-1.5 rounded-full bg-hood" />
          registry attached
        </span>
      </div>

      <ul className="divide-y divide-line">
        {rows.map(function renderRow(row) {
          const fixed = row.state === "fixed";
          const struck = row.state === "struck";
          return (
            <li key={row.label} className="grid grid-cols-[76px_1fr_auto] items-center gap-3 px-4 py-2.5">
              <span className="mono-label !text-[10px]">{row.label}</span>
              <span className="relative min-w-0 font-mono text-[12px]">
                <AnimatePresence mode="wait" initial={false}>
                  {fixed ? (
                    <motion.span
                      key="truth"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                      className="block truncate text-ink"
                    >
                      {row.truth}
                    </motion.span>
                  ) : (
                    <motion.span
                      key="guess"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className={`block truncate ${struck ? "text-ink-faint line-through decoration-ink-faint/70" : "text-ink-soft"}`}
                    >
                      {row.guess}
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
              <span className="grid h-5 w-5 place-items-center">
                {fixed ? (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 340, damping: 18 }}
                    className="grid h-5 w-5 place-items-center rounded-full bg-hood-wash"
                  >
                    <Check className="h-3 w-3 text-hood-deep" strokeWidth={3} />
                  </motion.span>
                ) : (
                  <WrongMark className={`h-3.5 w-3.5 ${struck ? "text-ink-soft" : "text-ink-faint/50"}`} strokeWidth={2.2} />
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-faint">
        five of the facts handed to every build · checked against the live chain
      </p>
    </div>
  );
}

// Owns the on-screen check, so the page (a server component) can drop it in.
export function ChainRegistryPanel(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const active = useInView(hostRef, { amount: 0.4 });
  return (
    <div ref={hostRef} className="h-full w-full">
      <ChainRegistryDemo active={active} />
    </div>
  );
}
