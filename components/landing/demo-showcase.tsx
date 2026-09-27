"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { SectionHeader } from "@/components/landing/kit";
import { Reveal } from "@/components/landing/reveal";

// Shared shell for the two demo bands (build-demos, defi-demos): selector cards
// on the left swap a browser-mock preview on the right. The mocks illustrate
// template output; they are not claims about live traffic. "Build this one"
// hands the card's prompt to the hero box, which listens for "fletch:prefill"
// in components/chat/agent-chat.

export interface Demo {
  id: string;
  badge: string;
  title: string;
  body: string;
  prompt: string;
  address: string;
}

export function prefillHero(prompt: string): void {
  window.dispatchEvent(new CustomEvent("fletch:prefill", { detail: prompt }));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

export function Metric({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="rounded-lg border border-line p-3">
      <p className="mono-label !text-[10px]">{label}</p>
      <p className="display mt-1 text-[16px] text-ink sm:text-[20px]">{value}</p>
    </div>
  );
}

interface DemoShowcaseProps {
  sectionId: string;
  eyebrow: string;
  lead: string;
  trail: string;
  deck: string;
  demos: Demo[];
  renderPreview: (id: string) => ReactNode;
}

export function DemoShowcase({
  sectionId,
  eyebrow,
  lead,
  trail,
  deck,
  demos,
  renderPreview,
}: DemoShowcaseProps): ReactElement {
  const [selectedId, setSelectedId] = useState(demos[0].id);
  const selected = demos.find(function match(demo) {
    return demo.id === selectedId;
  }) ?? demos[0];

  return (
    <section id={sectionId} className="relative scroll-mt-16 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:py-16">
        <SectionHeader centered eyebrow={eyebrow} lead={lead} trail={trail} deck={deck} />

        <div className="grid gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-3 lg:col-span-4">
            {demos.map(function renderCard(demo) {
              const active = demo.id === selectedId;
              return (
                <article
                  key={demo.id}
                  onClick={function select() {
                    setSelectedId(demo.id);
                  }}
                  className={`cursor-pointer rounded-xl border p-5 transition-colors ${
                    active
                      ? "border-hood/60 bg-raised shadow-[0_16px_40px_-28px_rgba(1,118,14,0.45)]"
                      : "border-line bg-panel/40 hover:border-line-strong hover:bg-raised"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={function select() {
                        setSelectedId(demo.id);
                      }}
                      className="display text-left text-[17px] text-ink"
                    >
                      {demo.title}
                    </button>
                    <span
                      className={`mono-label !text-[10px] shrink-0 rounded-full border px-2 py-0.5 ${
                        active ? "border-hood/50 !text-hood-deep" : "border-line"
                      }`}
                    >
                      {demo.badge}
                    </span>
                  </div>
                  <p className="mt-2 text-[14px] leading-6 text-ink-soft">{demo.body}</p>
                  <button
                    type="button"
                    onClick={function build(event) {
                      event.stopPropagation();
                      prefillHero(demo.prompt);
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-hood-deep transition-transform hover:translate-x-0.5"
                  >
                    Build this one →
                  </button>
                </article>
              );
            })}
          </div>

          <Reveal className="lg:col-span-8">
            <div className="overflow-hidden rounded-xl border border-line bg-white shadow-[0_24px_70px_-40px_rgba(14,16,15,0.35)]">
              <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
                <div className="flex shrink-0 gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
                  <span className="h-2.5 w-2.5 rounded-full bg-hood/60" />
                </div>
                <p className="truncate rounded-full border border-line bg-white px-3 py-1 font-mono text-[11px] text-ink-soft">
                  {selected.address}
                </p>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-white px-2.5 py-0.5 font-mono text-[10.5px] text-ink-soft">
                  Example UI · illustrative data
                </span>
              </div>
              <div key={selected.id} className="p-5 sm:p-6">
                {renderPreview(selected.id)}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
