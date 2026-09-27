"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check } from "@/components/ui/icons";

// The stage rail shown while a build runs: six stages, the active one lit and
// breathing, the ones behind it ticked, and a bar underneath that fills as the
// build moves. The transcript lists every step; this answers "where is it now".

export type Stage = "idle" | "planning" | "writing" | "compiling" | "testing" | "deploying" | "hosting" | "done";

const ORDER: Stage[] = ["planning", "writing", "compiling", "testing", "deploying", "hosting"];
const LABEL: Record<string, string> = {
  planning: "Plan",
  writing: "Write",
  compiling: "Compile",
  testing: "Test",
  deploying: "Deploy",
  hosting: "Preview",
};

function positionOf(stage: Stage): number {
  if (stage === "done") {
    return ORDER.length;
  }
  return ORDER.indexOf(stage);
}

export function Pipeline({ stage }: { stage: Stage }) {
  const reduced = useReducedMotion();
  if (stage === "idle") {
    return null;
  }
  const current = positionOf(stage);
  const progress = Math.min(1, (current + (stage === "done" ? 0 : 0.5)) / ORDER.length);

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <ol className="flex items-center gap-1">
        {ORDER.map(function renderStage(name, index) {
          const complete = index < current;
          const active = index === current;
          return (
            <li key={name} className="flex items-center gap-1">
              <span
                className={`relative flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors ${
                  complete ? "bg-hood-wash text-hood-deep" : active ? "text-paper" : "bg-panel text-ink-faint"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="pipeline-active"
                    className="absolute inset-0 rounded-full bg-ink"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="relative flex items-center gap-1.5">
                  {complete ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                  {active ? (
                    <motion.span
                      className="inline-flex h-1.5 w-1.5 rounded-full bg-hood"
                      animate={reduced ? undefined : { scale: [1, 1.6, 1], opacity: [1, 0.5, 1] }}
                      transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  ) : null}
                  {LABEL[name]}
                </span>
              </span>
              {index < ORDER.length - 1 ? <span className={`h-px w-2 ${complete ? "bg-hood/40" : "bg-line"}`} /> : null}
            </li>
          );
        })}
      </ol>
      <div className="relative h-0.5 w-full overflow-hidden rounded-full bg-line">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-hood"
          initial={false}
          animate={{ width: `${progress * 100}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 24 }}
        />
        {stage !== "done" && !reduced ? (
          <motion.div
            className="absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-white/70 to-transparent"
            animate={{ left: ["-10%", "110%"] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
            aria-hidden="true"
          />
        ) : null}
      </div>
    </div>
  );
}
