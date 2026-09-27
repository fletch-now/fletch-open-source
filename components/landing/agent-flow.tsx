"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "framer-motion";
import { Bot, CheckCircle2, Cpu } from "@/components/ui/icons";

// The schema, animated: what your own coding agent does, what Fletch adds, and what
// comes back. Three stages, a packet travelling the wire between them, and the
// active stage lit — so the division of labour is legible without reading the copy.

const AGENTS = ["Claude Code", "Cursor", "Cline", "Codex"];

const STAGES = [
  {
    icon: Bot,
    title: "Your agent",
    caption: "writes the code",
    detail: "It writes fluent Solidity but has never seen this chain.",
  },
  {
    icon: Cpu,
    title: "Fletch",
    caption: "supplies what it lacks",
    detail: "A verified chain registry, then a sandbox that compiles and tests the result.",
  },
  {
    icon: CheckCircle2,
    title: "You",
    caption: "get the verdict, then Watch",
    detail: "The ABI, every test with its gas. Then Watch flags large transfers after your agent exits.",
  },
];

const DWELL_MS = 2600;

export function AgentFlow() {
  const hostRef = useRef<HTMLDivElement>(null);
  const inView = useInView(hostRef, { amount: 0.3 });
  const [stage, setStage] = useState(0);
  const [agent, setAgent] = useState(0);

  useEffect(
    function advance() {
      if (!inView || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      const timer = setTimeout(function next() {
        setStage(function bump(current) {
          const following = (current + 1) % STAGES.length;
          // The agent name only changes when the cycle restarts, so it reads as a
          // new run rather than as flicker.
          if (following === 0) {
            setAgent(function rotate(index) {
              return (index + 1) % AGENTS.length;
            });
          }
          return following;
        });
      }, DWELL_MS);
      return function stop() {
        clearTimeout(timer);
      };
    },
    [stage, inView],
  );

  return (
    <div ref={hostRef} className="overflow-hidden rounded-card border border-line bg-raised">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="mono-label">the handoff</span>
        <span className="ml-auto font-mono text-[11px] text-ink-faint">
          {AGENTS[agent]} → Fletch
        </span>
      </div>

      <div className="grid gap-px bg-line md:grid-cols-3">
        {STAGES.map(function renderStage(item, index) {
          const active = index === stage;
          const done = index < stage;
          const Icon = item.icon;
          return (
            <div key={item.title} className="relative bg-raised p-6 lg:p-7">
              <div className="mb-4 flex items-center gap-2.5">
                <span
                  className={`grid h-8 w-8 shrink-0 place-items-center transition-colors duration-500 ${
                    active ? "text-black" : done ? "text-hood-deep" : "text-ink-faint"
                  }`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.9} />
                </span>
                <div className="min-w-0">
                  <p className="text-[14.5px] font-medium text-ink">{item.title}</p>
                  <p className="font-mono text-[11px] text-ink-faint">{item.caption}</p>
                </div>
              </div>
              <p className="text-[13.5px] leading-6 text-ink-soft">{item.detail}</p>

              {/* The travelling packet: a dot crossing the wire into the next stage. */}
              {index < STAGES.length - 1 ? (
                <div className="pointer-events-none absolute -right-px top-1/2 hidden h-px w-6 -translate-y-1/2 bg-line md:block">
                  {active ? (
                    <motion.span
                      className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-hood"
                      initial={{ left: "-8px", opacity: 0 }}
                      animate={{ left: "26px", opacity: [0, 1, 1, 0] }}
                      transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.5 }}
                    />
                  ) : null}
                </div>
              ) : null}

              <span
                className={`absolute inset-x-0 bottom-0 h-0.5 origin-left bg-hood transition-transform duration-500 ${
                  active ? "scale-x-100" : "scale-x-0"
                }`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
