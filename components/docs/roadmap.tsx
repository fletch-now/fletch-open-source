"use client";

import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { motion, useReducedMotion } from "framer-motion";
import { ROADMAP_STAGES, type RoadmapStage } from "@/lib/docs/roadmap";

const STAGE_COLORS: Record<RoadmapStage["id"], string> = {
  shipped: "bg-hood",
  now: "bg-ink",
  next: "bg-ink-faint",
  later: "bg-line",
};

export function DocsRoadmap(): ReactElement {
  const reducedMotion = useReducedMotion();
  const itemCount = ROADMAP_STAGES.reduce(function count(total, stage) {
    return total + stage.items.length;
  }, 0);

  return (
    <div className="space-y-8">
      <nav aria-label="Roadmap stages">
        <ol className="grid grid-cols-4">
          {ROADMAP_STAGES.map(function stageLink(stage, index) {
            return (
              <li key={stage.id} className="relative min-w-0">
                {index < ROADMAP_STAGES.length - 1 ? <span aria-hidden="true" className="absolute left-4 right-0 top-4 h-px bg-line" /> : null}
                <motion.a
                  href={`#roadmap-${stage.id}`}
                  tabIndex={0}
                  initial={false}
                  whileHover={reducedMotion === false ? { y: -2 } : undefined}
                  whileTap={reducedMotion === false ? { y: 0 } : undefined}
                  transition={{ duration: 0.16 }}
                  className="group relative inline-flex max-w-full flex-col items-start rounded-lg pr-2 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood"
                >
                  <span aria-hidden="true" className={`flex size-8 items-center justify-center rounded-full border font-mono text-[11px] ${stage.id === "shipped" ? "border-hood bg-hood text-ink" : "border-line bg-raised text-ink-soft"}`}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="mt-3 text-[14px] font-medium text-ink group-hover:underline group-hover:underline-offset-4">{stage.title}</span>
                  <span className="mt-1 text-[11px] tabular-nums text-ink-faint">{stage.items.length} items</span>
                </motion.a>
              </li>
            );
          })}
        </ol>
      </nav>

      <figure className="rounded-card border border-line bg-panel/40 p-5 sm:p-6">
        <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium text-ink">Roadmap item counts</span>
          <span className="font-mono text-[12px] tabular-nums text-ink-faint">{itemCount} items across 4 stages</span>
        </figcaption>
        <div aria-hidden="true" className="mt-5 flex h-3 gap-1 overflow-hidden rounded-full">
          {ROADMAP_STAGES.map(function segment(stage) {
            return <div key={stage.id} className={STAGE_COLORS[stage.id]} style={{ width: `${stage.items.length / itemCount * 100}%` }} />;
          })}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
          {ROADMAP_STAGES.map(function count(stage) {
            return (
              <div key={stage.id} className="flex items-center gap-2 text-[12px]">
                <span aria-hidden="true" className={`size-2 shrink-0 rounded-sm ${STAGE_COLORS[stage.id]}`} />
                <dt className="text-ink-soft">{stage.title}</dt>
                <dd className="ml-auto font-mono tabular-nums text-ink">{stage.items.length}</dd>
              </div>
            );
          })}
        </dl>
        <p className="mt-4 text-[12px] leading-5 text-ink-faint">Each segment counts the items listed below. Item sizes vary. Planned capabilities have no announced delivery dates.</p>
      </figure>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {ROADMAP_STAGES.map(function panel(stage) {
          return (
            <section key={stage.id} id={`roadmap-${stage.id}`} aria-labelledby={`roadmap-${stage.id}-title`} className="min-w-0 scroll-mt-24 rounded-card border border-line bg-raised">
              <header className="border-b border-line p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 id={`roadmap-${stage.id}-title`} className="text-[21px] font-medium tracking-tight text-ink">{stage.title}</h2>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${stage.id === "shipped" ? "bg-hood-wash text-hood-deep" : "bg-panel text-ink-soft"}`}>{stage.status}</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-ink-faint">{stage.description}</p>
              </header>
              <ul className="space-y-3 p-3 sm:p-4">
                {stage.items.map(function feature(item, index) {
                  return (
                    <motion.li
                      key={item.title}
                      initial={false}
                      whileHover={reducedMotion === false ? { y: -2 } : undefined}
                      transition={{ duration: 0.16 }}
                      className="rounded-xl border border-line/80 bg-raised p-4"
                    >
                      <div className="flex items-baseline gap-3">
                        <span aria-hidden="true" className="font-mono text-[10px] tabular-nums text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                        <h3 className="text-[14px] font-medium leading-6 text-ink">{item.title}</h3>
                      </div>
                      <p className="mt-2 text-[13px] leading-[1.75] text-ink-soft">{item.description}</p>
                    </motion.li>
                  );
                })}
              </ul>
              {stage.links.length > 0 ? (
                <footer className="border-t border-line px-5 py-4 sm:px-6">
                  <ul className="flex flex-wrap gap-x-5 gap-y-3">
                    {stage.links.map(function resource(link) {
                      return (
                        <li key={link.href}>
                          <Link href={link.href} prefetch={false} className="text-[12px] text-ink-soft underline decoration-line underline-offset-4 hover:decoration-hood focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood">
                            {link.label}<span aria-hidden="true"> ↗</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </footer>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
