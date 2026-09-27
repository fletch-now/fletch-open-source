"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";

// The hero's object: the monument render on the page's own ground, with light that
// is alive around it. Back to front: a slow aurora of green pools whose centres
// wander so the colour behind the wood never repeats; the image itself, which only
// drifts; and, in front, sparks that spiral up around the arrow — dimmer and smaller
// on the far side of their orbit, so they read as passing behind it.
//
// Cost is kept tiny on purpose: the aurora is soft gradients, so it is painted on a
// 160-pixel canvas and scaled up by the browser; the sparks canvas runs at 1x. No
// WebGL — a shader layer here took a GPU process down on a real machine.

interface Spark {
  angle: number;
  omega: number;
  radius: number;
  y: number;
  vy: number;
  life: number;
  size: number;
}

function seed(index: number, salt: number): number {
  const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function newSpark(index: number, t: number): Spark {
  return {
    angle: seed(index, t) * Math.PI * 2,
    omega: (0.5 + seed(index, t + 1) * 0.7) * (seed(index, t + 5) < 0.5 ? -1 : 1),
    radius: 0.12 + seed(index, t + 2) * 0.16,
    y: 0.74 + seed(index, t + 3) * 0.08,
    vy: 0.028 + seed(index, t + 4) * 0.022,
    life: 0,
    size: 0.45 + seed(index, t + 6) * 0.8,
  };
}

// The three pools, each with its own colour, size, and wander rhythm.
const POOLS = [
  { hue: "170, 255, 110", radius: 0.36, cx: 0.5, cy: 0.66, speed: 0.11, phase: 0.0, alpha: 0.18 },
  { hue: "96, 200, 120", radius: 0.44, cx: 0.45, cy: 0.6, speed: 0.08, phase: 2.1, alpha: 0.11 },
  { hue: "140, 190, 60", radius: 0.28, cx: 0.55, cy: 0.7, speed: 0.14, phase: 4.2, alpha: 0.12 },
];

// The light layers overhang the image on every side but the bottom, where the
// section ends; the aurora is drawn to fade before that edge.
const OVERHANG = "pointer-events-none absolute inset-0 h-full w-full origin-bottom scale-[1.32]";

export function HeroFigure() {
  const backRef = useRef<HTMLCanvasElement>(null);
  const frontRef = useRef<HTMLCanvasElement>(null);

  useEffect(function mount() {
    const back = backRef.current;
    const front = frontRef.current;
    const bctx = back?.getContext("2d");
    const fctx = front?.getContext("2d");
    if (!back || !front || !bctx || !fctx) {
      return;
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    const COUNT = coarse ? 18 : 34;
    const sparks: Spark[] = [];
    for (let i = 0; i < COUNT; i += 1) {
      const spark = newSpark(i, 0);
      spark.life = seed(i, 9);
      sparks.push(spark);
    }

    // The aurora canvas holds a fixed, tiny backing store; CSS stretches it.
    const AURORA_WIDTH = 160;
    // The sparks canvas is intentionally 1x, not devicePixelRatio — see header comment.
    const dpr = 1;
    function resize(): void {
      const rect = front!.getBoundingClientRect();
      front!.width = Math.max(1, Math.round(rect.width));
      front!.height = Math.max(1, Math.round(rect.height));
      back!.width = AURORA_WIDTH;
      back!.height = Math.max(1, Math.round((AURORA_WIDTH * rect.height) / Math.max(1, rect.width)));
    }
    resize();

    let frame = 0;
    let visible = true;
    let last = performance.now();
    let t = 0;

    function paint(dt: number): void {
      t += dt;

      // ---- back: the aurora
      const bw = back!.width;
      const bh = back!.height;
      bctx!.clearRect(0, 0, bw, bh);
      bctx!.globalCompositeOperation = "lighter";
      POOLS.forEach(function pool(p, i): void {
        const cx = (p.cx + Math.sin(t * p.speed * 2 + p.phase) * 0.06 + Math.cos(t * p.speed * 1.3 + i) * 0.04) * bw;
        const cy = (p.cy + Math.cos(t * p.speed * 1.7 + p.phase) * 0.04) * bh;
        const r = p.radius * Math.min(bw, bh) * (1 + Math.sin(t * p.speed * 3 + i) * 0.08);
        const breath = p.alpha * (0.85 + Math.sin(t * 0.45 + p.phase) * 0.15);
        const g = bctx!.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(${p.hue}, ${breath})`);
        g.addColorStop(0.45, `rgba(${p.hue}, ${breath * 0.35})`);
        g.addColorStop(1, `rgba(${p.hue}, 0)`);
        bctx!.fillStyle = g;
        bctx!.fillRect(0, 0, bw, bh);
      });
      const mask = bctx!.createRadialGradient(bw / 2, bh * 0.55, 0, bw / 2, bh * 0.55, Math.max(bw, bh) * 0.52);
      mask.addColorStop(0.45, "rgba(0, 0, 0, 1)");
      mask.addColorStop(1, "rgba(0, 0, 0, 0)");
      bctx!.globalCompositeOperation = "destination-in";
      bctx!.fillStyle = mask;
      bctx!.fillRect(0, 0, bw, bh);
      bctx!.globalCompositeOperation = "source-over";

      // ---- front: sparks spiralling up around the figure
      const fw = front!.width;
      const fh = front!.height;
      fctx!.clearRect(0, 0, fw, fh);
      fctx!.globalCompositeOperation = "lighter";
      sparks.forEach(function draw(spark, i): void {
        spark.life += dt * 0.1;
        spark.y -= spark.vy * dt;
        spark.angle += spark.omega * dt;
        if (spark.life >= 1) {
          sparks[i] = newSpark(i, t);
          return;
        }
        const fade = Math.sin(spark.life * Math.PI);
        // Orbit around the figure's axis; the far half of the orbit is dimmer and
        // smaller, so the spark reads as passing behind the arrow.
        const depth = (Math.sin(spark.angle) + 1) / 2;
        const x = (0.5 + Math.cos(spark.angle) * spark.radius) * fw;
        const y = spark.y * fh;
        const r = spark.size * dpr * (0.6 + depth * 0.6);
        const a = fade * (0.35 + depth * 0.6);
        fctx!.beginPath();
        fctx!.arc(x, y, r * 2.4, 0, Math.PI * 2);
        fctx!.fillStyle = `rgba(200, 255, 140, ${0.1 * a})`;
        fctx!.fill();
        fctx!.beginPath();
        fctx!.arc(x, y, r, 0, Math.PI * 2);
        fctx!.fillStyle = `rgba(240, 255, 210, ${0.9 * a})`;
        fctx!.fill();
      });
      fctx!.globalCompositeOperation = "source-over";
    }

    function tick(now: number): void {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      paint(dt);
      frame = visible && !document.hidden && !reduced ? requestAnimationFrame(tick) : 0;
    }

    const resizeObserver = new ResizeObserver(function onResize(): void {
      resize();
      paint(0);
    });
    resizeObserver.observe(back);
    const intersection = new IntersectionObserver(function onCross(entries): void {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible && !frame && !reduced) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
      if (!visible && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    });
    intersection.observe(back);
    paint(0);
    if (!reduced) frame = requestAnimationFrame(tick);

    return function unmount(): void {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersection.disconnect();
    };
  }, []);

  return (
    <div className="relative mx-auto w-[min(80vw,400px)] lg:absolute lg:inset-y-0 lg:right-[max(1rem,calc((100vw-80rem)/2))] lg:mx-0 lg:flex lg:w-[38vw] lg:max-w-[620px] lg:items-center">
      <div className="relative w-full">
        <canvas ref={backRef} aria-hidden="true" className={OVERHANG} />
        {/* All light stays behind the render: a ground shadow under the mound and a
            wider low glow, so the arrow is lit from below rather than hazed over. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[3%] left-1/2 h-[16%] w-[80%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(120,200,70,0.28),rgba(40,90,30,0.14)_55%,transparent_75%)] blur-2xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-6%] left-1/2 h-[30%] w-[110%] -translate-x-1/2 rounded-[100%] bg-[radial-gradient(closest-side,rgba(70,130,45,0.32),rgba(30,70,25,0.14)_50%,transparent_100%)] blur-xl"
        />
        {/* The bottom edge dissolves on an ellipse instead of a straight fade, so
            the render merges into the black the way light falls off — no seam. */}
        <Image
          src="/brand/fletch-hero.webp"
          alt=""
          width={1279}
          height={1039}
          priority
          sizes="(min-width: 1024px) 38vw, 80vw"
          className="hero-drift relative h-auto w-full select-none [mask-image:radial-gradient(ellipse_120%_100%_at_50%_30%,black_62%,transparent_85%)]"
        />
        <canvas ref={frontRef} aria-hidden="true" className={OVERHANG} />
      </div>
    </div>
  );
}
