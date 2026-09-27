"use client";

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import Image from "next/image";
import { Eyebrow } from "@/components/landing/kit";
import { Reveal } from "@/components/landing/reveal";
import { Separator } from "@/components/new-separator";

const ITEMS = [
  {
    title: "Recorded token identities",
    body: "The builder starts with recorded chain configuration and addresses. It can query Fletch for token identities and indexed pools as the app needs them. The response shows the observed facts and their age.",
  },
  {
    title: "Recorded build checks",
    body: "Fletch compiles contracts with Foundry, runs their tests and records Slither findings. These checks cover the code and assertions that ran. You can inspect each report and test the app with your wallet.",
  },
  {
    title: "Events watched in the background",
    body: "Watch reads mainnet events in the background and saves its scan position. Matches appear in your dashboard, with optional Telegram or webhook delivery. Reading and delivery delays remain visible in the app.",
  },
];

// Small and starry, like the hero's motes: each particle gets its own spinning
// frame so orbit radius, period, and direction differ — a shared one would read
// as a loading spinner. The frame carries the rotation (globals' orbit-spin
// keyframe); the dot rides the edge.
const ORBITS = [
  { top: "5%", left: "50%", size: 3, duration: "18s", reverse: false, className: "bg-hood shadow-[0_0_8px_rgba(0,200,5,0.8)]" },
  { top: "50%", left: "96%", size: 2, duration: "26s", reverse: true, className: "bg-hood/70 shadow-[0_0_6px_rgba(0,200,5,0.6)]" },
  { top: "92%", left: "38%", size: 3, duration: "23s", reverse: false, className: "bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.5)]" },
  { top: "34%", left: "2%", size: 2, duration: "30s", reverse: true, className: "bg-hood/60 shadow-[0_0_6px_rgba(0,200,5,0.55)]" },
  { top: "70%", left: "90%", size: 2, duration: "21s", reverse: false, className: "bg-white/60 shadow-[0_0_6px_rgba(255,255,255,0.45)]" },
];

function FloatCard({
  active,
  className,
  children,
}: {
  active: boolean;
  className: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div
      className={`absolute max-w-[180px] rounded-xl border px-4 py-3 backdrop-blur-md transition-all duration-500 sm:max-w-none ${
        active
          ? "border-hood/70 bg-white/[0.08] shadow-[0_0_0_1px_rgba(0,200,5,0.45),0_0_44px_-6px_rgba(0,200,5,0.55)]"
          : "border-white/10 bg-white/[0.05]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function OracleSection(): ReactElement {
  const [open, setOpen] = useState(0);
  // The band advances on its own so every card gets its halo in turn; hovering
  // or focusing the accordion hands control back to the reader (WCAG 2.2.2).
  const [auto, setAuto] = useState(true);

  useEffect(function rotate() {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = setInterval(function advance() {
      setOpen(function next(current) {
        return (current + 1) % ITEMS.length;
      });
    }, 4500);
    return function stop() {
      clearInterval(timer);
    };
  }, [auto]);

  return (
    <section id="oracle" className="relative bg-night text-white">
      <Separator edge="top" />
      <div className="mx-auto grid w-full max-w-7xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-2 lg:gap-16 lg:py-32">
        <div>
          <Eyebrow onDark className="mb-7">
            ROBINHOOD CHAIN · 4663
          </Eyebrow>
          <h2 className="display max-w-xl text-balance text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.95] tracking-[-0.02em]">
            Give your app chain data it can explain.
          </h2>

          <div
            className="mt-10 divide-y divide-white/10 border-y border-white/10"
            onMouseEnter={function pause() {
              setAuto(false);
            }}
            onMouseLeave={function resume() {
              setAuto(true);
            }}
            onFocus={function pause() {
              setAuto(false);
            }}
            onBlur={function resume() {
              setAuto(true);
            }}
          >
            {ITEMS.map(function renderItem(item, index) {
              const isOpen = open === index;
              return (
                <div key={item.title}>
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={function select() {
                      setOpen(index);
                    }}
                    className="group flex w-full items-baseline gap-4 py-5 text-left"
                  >
                    <span className="font-mono text-[12px] text-white/40">0{index + 1} /</span>
                    <span
                      className={`display text-[19px] transition-colors ${
                        isOpen ? "text-white" : "text-white/70 group-hover:text-white"
                      }`}
                    >
                      {item.title}
                    </span>
                    <span
                      aria-hidden="true"
                      className={`ml-auto font-mono text-[18px] text-white/50 transition-transform duration-300 ${
                        isOpen ? "rotate-45" : ""
                      }`}
                    >
                      +
                    </span>
                  </button>
                  {/* Fixed open height: exactly one item is open at a time, and the
                      closing and opening rows trade the same pixels on the same
                      easing, so the band never changes size while it rotates. */}
                  <div
                    className={`overflow-hidden transition-all duration-500 ${
                      isOpen ? "h-[190px] opacity-100 sm:h-[140px]" : "h-0 opacity-0"
                    }`}
                  >
                    <p className="max-w-md pb-5 pl-9 text-[14.5px] leading-7 text-white/65">{item.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Reveal className="relative">
          <div className="relative mx-auto w-full max-w-[540px]">
            {/* Flat black behind the render; the only green is the star field. */}
            {ORBITS.map(function particle(orbit) {
              return (
                <div
                  key={`${orbit.top}-${orbit.left}`}
                  aria-hidden="true"
                  className="absolute inset-0 motion-safe:[animation:orbit-spin_20s_linear_infinite]"
                  style={{
                    animationDuration: orbit.duration,
                    animationDirection: orbit.reverse ? "reverse" : "normal",
                  }}
                >
                  <span
                    className={`absolute rounded-full ${orbit.className}`}
                    style={{ top: orbit.top, left: orbit.left, width: orbit.size, height: orbit.size }}
                  />
                </div>
              );
            })}
            <Image
              src="/brand/oracle-pic.png"
              alt=""
              width={1262}
              height={1246}
              sizes="(min-width: 1024px) 540px, 90vw"
              className="hero-drift relative h-auto w-full"
            />

            <FloatCard active={open === 0} className="left-0 top-[7%]">
              <p className="flex items-center gap-2 text-[13.5px] font-medium">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-hood" />
                Token identity
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-white/55">Listing and contract checks</p>
            </FloatCard>

            <FloatCard active={open === 1} className="right-0 top-[15%]">
              <p className="text-[13.5px] font-medium">Build reports</p>
              <p className="mt-0.5 font-mono text-[10.5px] text-hood">Inspect compiler and test output</p>
            </FloatCard>

            <FloatCard active={open === 2} className="bottom-[5%] left-1/2 -translate-x-1/2 whitespace-nowrap">
              <p className="font-mono text-[11.5px] text-white/70">
                Watch checkpoints
              </p>
              <p className="mt-0.5 font-mono text-[10.5px] text-white/55">Recorded block and observation time</p>
            </FloatCard>
          </div>
        </Reveal>
      </div>
      <Separator edge="bottom" />
    </section>
  );
}
