"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, Paperclip, Send } from "@/components/ui/icons";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { usePrefersReducedMotion } from "@/components/landing/demos/use-reduced-motion";

// A Telegram conversation with the bot: link once with the /start deep link from
// the dashboard, then the bot pushes an alert whenever a large transfer crosses
// your threshold on a registry-verified Stock Token. The link reply and the alert
// text below match what the bot actually sends (app/api/webhooks/telegram/route.ts,
// lib/watch/format.ts).
//
// The header still says "preview": the addresses, amounts, and timestamps here are
// placeholders, not activity from an account.

type Side = "bot" | "user";

interface Bubble {
  id: string;
  side: Side;
  text: string;
  /** Inline keyboard under a bot message, as Telegram renders it. */
  buttons?: string[];
  /** Which button the person taps next, so it lights before the reply arrives. */
  pressed?: string;
  /** A small data block rendered above the text. */
  rows?: string[];
}

// The exchange, in order. Timings are per step so a reader can follow each turn.
const SCRIPT: Array<{ bubble?: Bubble; typing?: boolean; hold: number }> = [
  { bubble: { id: "u1", side: "user", text: "/start 8f2k9pQ2mLz1" }, hold: 1400 },
  { typing: true, hold: 900 },
  { bubble: { id: "a1", side: "bot", text: "Linked. Fletch will message you here." }, hold: 2200 },
  { typing: true, hold: 1300 },
  {
    bubble: {
      id: "a2",
      side: "bot",
      rows: ["42,000 AAPL", "from 0x7a2f…9c41 · to 0x3b81…22e0"],
      text: "Large transfer, above your 10,000 threshold. Sequencer-confirmed, not yet final on Ethereum.",
    },
    hold: 2800,
  },
  { typing: true, hold: 1100 },
  {
    bubble: {
      id: "a3",
      side: "bot",
      rows: ["6,500 NVDA", "from 0x51e0…7f2a · to 0x902c…6b18"],
      text: "Large transfer, above your 2,500 threshold. Sequencer-confirmed, not yet final on Ethereum.",
    },
    hold: 2800,
  },
];

const RESTART_HOLD = 1800;

function TypingDots(): React.JSX.Element {
  return (
    <span className="flex items-center gap-1 px-1">
      {[0, 1, 2].map(function renderDot(index) {
        return (
          <motion.span
            key={index}
            className="h-1.5 w-1.5 rounded-full bg-ink-faint"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
            transition={{ duration: 0.9, repeat: Infinity, delay: index * 0.15 }}
          />
        );
      })}
    </span>
  );
}

export function TelegramChat({ active }: { active: boolean }): React.JSX.Element {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(0);
  const [pressedId, setPressedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(
    function advance() {
      if (!active || reduced) {
        return;
      }
      const current = SCRIPT[step];
      const timers: number[] = [];
      // A button lights just before the reply it triggers, so cause reads before effect.
      if (current?.bubble?.pressed) {
        timers.push(window.setTimeout(function press() { setPressedId(current.bubble!.id); }, current.hold - 600));
      }
      timers.push(
        window.setTimeout(
          function next() {
            setStep(function bump(index) {
              const following = index + 1;
              if (following > SCRIPT.length) {
                setPressedId(null);
                return 0;
              }
              return following;
            });
          },
          step === SCRIPT.length ? RESTART_HOLD : (current?.hold ?? 1000),
        ),
      );
      return function stop() {
        timers.forEach(function clear(id) { window.clearTimeout(id); });
      };
    },
    [active, reduced, step],
  );

  // Keep the newest message in view inside the phone, never scrolling the page.
  useEffect(
    function follow() {
      const el = scrollRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
      }
    },
    [step, reduced],
  );

  const settled = reduced || !active;
  const shownSteps = settled ? SCRIPT : SCRIPT.slice(0, Math.min(step, SCRIPT.length));
  const bubbles = shownSteps.filter(function isBubble(s) { return Boolean(s.bubble); }).map(function pick(s) { return s.bubble as Bubble; });
  const typing = !settled && step < SCRIPT.length && Boolean(SCRIPT[step]?.typing);

  return (
    <div className="mx-auto w-full max-w-[340px] overflow-hidden rounded-[26px] border border-line bg-raised shadow-[0_30px_80px_-40px_rgba(13,18,14,0.55)]">
      {/* Header, as Telegram lays it out: back, avatar, name, status. */}
      <div className="flex items-center gap-2.5 border-b border-line bg-panel/70 px-3 py-2.5">
        <ChevronLeft className="h-4 w-4 text-ink-faint" strokeWidth={2} />
        <span className="grid h-8 w-8 place-items-center rounded-full bg-hood text-black">
          <TelegramMark size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-ink">Fletch Alerts</p>
          <p className="font-mono text-[10px] text-hood-deep">bot · preview</p>
        </div>
        <span className="rounded-full bg-hood-wash px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-hood-deep">
          2 watchers
        </span>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex h-[360px] flex-col gap-2 overflow-y-auto bg-paper px-3 py-3 [scrollbar-width:none]">
        <p className="mb-1 text-center font-mono text-[9.5px] uppercase tracking-[0.08em] text-ink-faint">today</p>
        <AnimatePresence initial={false}>
          {bubbles.map(function renderBubble(bubble) {
            const isUser = bubble.side === "user";
            return (
              <motion.div
                key={bubble.id}
                layout
                initial={{ opacity: 0, y: 10, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3 py-2 ${
                    isUser
                      ? "rounded-br-md bg-hood text-black"
                      : "rounded-bl-md border border-line bg-raised text-ink"
                  }`}
                >
                  {bubble.rows ? (
                    <ul className="mb-2 divide-y divide-line rounded-lg border border-line bg-panel/60">
                      {bubble.rows.map(function renderRow(row) {
                        return (
                          <li key={row} className="px-2.5 py-1.5 font-mono text-[11px] text-ink-soft">
                            {row}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  <p className={`text-[12.5px] leading-5 ${isUser && bubble.text.startsWith("/") ? "font-mono" : ""}`}>
                    {bubble.text}
                  </p>
                  <p className={`mt-1 flex items-center justify-end gap-1 font-mono text-[9.5px] ${isUser ? "text-black/60" : "text-ink-faint"}`}>
                    09:4{bubble.id.slice(-1)}
                    {isUser ? <Check className="h-3 w-3" strokeWidth={2.5} /> : null}
                  </p>
                  {bubble.buttons ? (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {bubble.buttons.map(function renderButton(label) {
                        const lit = pressedId === bubble.id && bubble.pressed === label;
                        return (
                          <motion.span
                            key={label}
                            animate={lit ? { scale: [1, 0.94, 1] } : { scale: 1 }}
                            transition={{ duration: 0.35 }}
                            className={`rounded-lg border px-2 py-1.5 text-center text-[11.5px] font-medium transition-colors ${
                              lit
                                ? "border-hood bg-hood-wash text-hood-deep"
                                : "border-line bg-panel/60 text-ink-soft"
                            }`}
                          >
                            {label}
                          </motion.span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              </motion.div>
            );
          })}
          {typing ? (
            <motion.div
              key="typing"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex justify-start"
            >
              <div className="rounded-2xl rounded-bl-md border border-line bg-raised px-3 py-2.5">
                <TypingDots />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Composer */}
      <div className="flex items-center gap-2 border-t border-line bg-panel/70 px-3 py-2">
        <Paperclip className="h-4 w-4 shrink-0 text-ink-faint" strokeWidth={1.8} />
        <span className="flex h-8 flex-1 items-center rounded-full border border-line bg-raised px-3 font-mono text-[11.5px] text-ink-faint">
          Message
        </span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hood text-black">
          <Send className="h-3.5 w-3.5" strokeWidth={2.2} />
        </span>
      </div>
    </div>
  );
}
