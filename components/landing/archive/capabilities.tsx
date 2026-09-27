"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ConnectionBand } from "../brand-bands";
import { VerifiedTicker, type VerifiedSample } from "./verified-ticker";

// The reference's Capabilities section, rebuilt for Fletch: an oversized two-tone
// headline, then a bento of dark cards — one large with a drifting particle field,
// three below with a big figure each. No card borders; the cards are lifted from
// the ground by tone alone.
//
// The copy is the case for Fletch on this chain: the registry nobody else keeps,
// the daemon that reads every block, and builds the compiler has checked. Every
// figure is handed in by the server component from the live database.

// The 3D mark loads after the page paints; this card is below the fold.
const SpinningMark = dynamic(
  function load() {
    return import("../spinning-mark").then(function pick(m) {
      return { default: m.SpinningMark };
    });
  },
  { ssr: false },
);

export interface CapabilityStats {
  builds: number;
  assets: number;
  matched: number;
  wallets: number;
  // A handful of verified registry rows, for the ticker beside the headline.
  sample: VerifiedSample[];
}

interface Card {
  number: string;
  title: string;
  body: string;
  value: (stats: CapabilityStats) => string;
  label: string;
}

const CARDS: Card[] = [
  {
    number: "01",
    title: "Builds the compiler has checked",
    body: "You describe an app. An agent writes the Solidity and a small front end. Foundry compiles it in a locked-down sandbox and runs the tests, and what you see is the compiler's verdict on the finished code.",
    value: function reads(stats) { return String(stats.builds); },
    label: "builds run",
  },
  {
    number: "02",
    title: "An address book you can trust",
    body: "Each Stock Token on chain 4663 comes from Robinhood's own list and is checked for bytecode on chain before it is marked verified. The sync runs every fifteen minutes. A watcher can only point at one of these.",
    value: function reads(stats) { return String(stats.assets); },
    label: "verified assets",
  },
  {
    number: "03",
    title: "Watched block by block",
    body: "A daemon on Fletch's server checkpoints each block it clears and rolls back on a reorg. When a transfer clears your threshold it messages your Telegram within seconds.",
    value: function reads(stats) { return String(stats.matched); },
    label: "transfers matched",
  },
  {
    number: "04",
    title: "Wallet-native accounts",
    body: "A wallet signature is the account. Everything you build or watch stays tied to that wallet, and the same signature opens the API.",
    value: function reads(stats) { return String(stats.wallets); },
    label: "wallets connected",
  },
];

// The reference's floating-dot field, kept close to its original: stable seeded
// particles drifting on sines, leaning gently toward the pointer.
function ParticleField(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(function mount() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mouse = { x: 0.5, y: 0.5 };

    function resize(): void {
      const rect = canvas!.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    function onMove(event: MouseEvent): void {
      const rect = canvas!.getBoundingClientRect();
      mouse.x = (event.clientX - rect.left) / rect.width;
      mouse.y = (event.clientY - rect.top) / rect.height;
    }

    const COUNT = 70;
    const particles = Array.from({ length: COUNT }, function seedParticle(_, i) {
      const seed = i * 1.618;
      return {
        bx: (seed * 127.1) % 1,
        by: (seed * 311.7) % 1,
        phase: seed * Math.PI * 2,
        speed: 0.4 + (seed % 0.4),
        radius: 1.2 + (seed % 2.2),
      };
    });

    let time = 0;
    let frame = 0;
    function render(): void {
      const rect = canvas!.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx!.clearRect(0, 0, w, h);
      particles.forEach(function draw(p) {
        const flowX = Math.sin(time * p.speed * 0.4 + p.phase) * 38;
        const flowY = Math.cos(time * p.speed * 0.3 + p.phase * 0.7) * 24;
        const x = p.bx * w + flowX + (mouse.x - 0.5) * 26;
        const y = p.by * h + flowY + (mouse.y - 0.5) * 18;
        const pulse = 0.35 + Math.sin(time * p.speed + p.phase) * 0.2;
        ctx!.beginPath();
        ctx!.arc(x, y, p.radius, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(0, 200, 5, ${pulse})`;
        ctx!.fill();
      });
      time += 0.016;
      if (!reduced) {
        frame = requestAnimationFrame(render);
      }
    }

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    canvas.addEventListener("mousemove", onMove);
    render();

    return function unmount() {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}

function SourceTag(): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-hood">
      <span className="h-1 w-1 rounded-full bg-hood" />
      live from the platform database
    </span>
  );
}

export function Capabilities({ stats }: { stats: CapabilityStats }): React.JSX.Element {
  const sectionRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(function watch() {
    const section = sectionRef.current;
    if (!section) {
      return;
    }
    const observer = new IntersectionObserver(
      function onCross([entry]) {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold: 0.1 },
    );
    observer.observe(section);
    return function stop() {
      observer.disconnect();
    };
  }, []);

  const lead = CARDS[0];

  return (
    <section id="capabilities" ref={sectionRef} className="scroll-mt-16 bg-night text-white">
      <ConnectionBand />
      <div className="mx-auto w-full max-w-6xl px-5 pb-20 pt-12 sm:px-6 lg:pb-28 lg:pt-16">
        <div className="mb-16 grid items-end gap-8 lg:mb-20 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="mb-6 inline-flex items-center gap-3 font-mono text-[12.5px] text-white/60">
              <span aria-hidden="true" className="h-px w-12 bg-white/30" />
              why fletch
            </span>
            <h2
              className={`display text-balance text-[clamp(2.4rem,6vw,4.9rem)] leading-[0.92] tracking-tight transition-all duration-1000 ${
                visible ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"
              }`}
            >
              Every Stock Token, verified.
              <br />
              <span className="text-white/50">Every block, watched.</span>
            </h2>
          </div>
          <div className="lg:col-span-5 lg:pb-4">
            <p
              className={`text-[18px] leading-relaxed text-white/70 transition-all delay-200 duration-1000 ${
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
              }`}
            >
              Robinhood Chain is newer than the models that write code for it, so an
              agent on its own guesses at chain ids and token addresses. Fletch keeps
              the address book current and compiles what the agent writes in a sandbox.
              A daemon reads each block as it lands. The figures below are read from
              the database as the page loads.
            </p>
            <div
              className={`mt-6 transition-all delay-300 duration-1000 ${
                visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
              }`}
            >
              <VerifiedTicker sample={stats.sample} total={stats.assets} />
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
          <div
            className={`group relative flex min-h-[500px] overflow-hidden border border-white/10 bg-black transition-all duration-700 lg:col-span-12 ${
              visible ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
            }`}
          >
            <div className="relative flex-1 p-8 lg:p-12">
              <ParticleField />
              <div className="pointer-events-none relative z-10">
                <span className="font-mono text-[13px] text-white/50">{lead.number}</span>
                <h3 className="display mt-4 text-[30px] leading-tight transition-transform duration-500 group-hover:translate-x-2 lg:text-[38px]">
                  {lead.title}
                </h3>
                <p className="mb-8 mt-5 max-w-md text-[17px] leading-relaxed text-white/65">{lead.body}</p>
                <span className="display block text-[56px] leading-none tabular-nums lg:text-[72px]">
                  {lead.value(stats)}
                </span>
                <span className="mt-2 block font-mono text-[12.5px] text-white/55">{lead.label}</span>
                <div className="mt-4">
                  <SourceTag />
                </div>
              </div>
            </div>

            {/* The mark itself, turning: the reference card carries an image here. */}
            <div className="relative hidden w-[42%] shrink-0 lg:block">
              <SpinningMark />
              <div className="pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-black via-transparent to-transparent" />
            </div>
          </div>

          {CARDS.slice(1).map(function renderCard(card, index) {
            return (
              <div
                key={card.number}
                className={`group border border-white/10 bg-black p-8 transition-all duration-700 lg:col-span-4 ${
                  visible ? "translate-y-0 opacity-100" : "translate-y-12 opacity-0"
                }`}
                style={{ transitionDelay: `${150 + index * 100}ms` }}
              >
                <span className="font-mono text-[13px] text-white/50">{card.number}</span>
                <h3 className="display mt-3 text-[24px] leading-tight transition-transform duration-500 group-hover:translate-x-1.5">
                  {card.title}
                </h3>
                <p className="mt-4 min-h-[96px] text-[14.5px] leading-relaxed text-white/65">{card.body}</p>
                <span className="display mt-6 block text-[44px] leading-none tabular-nums">{card.value(stats)}</span>
                <span className="mt-1.5 block font-mono text-[12px] text-white/55">{card.label}</span>
                <div className="mt-3">
                  <SourceTag />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
