"use client";

import { useEffect, useRef } from "react";

// Rising green sparks over a brand render, the same life as the ones around the
// hero's arrow: each spark is born low in its spawn box, climbs, drifts on a sine,
// and fades in and out over its life. A 1x canvas laid over the image, paused when
// off-screen or under reduced motion. No WebGL; a shader here once took a GPU
// process down on a real machine.

interface Range {
  x: [number, number];
  y: [number, number];
}

interface SparkFieldProps {
  count?: number;
  // Where sparks are born, as fractions of the canvas.
  spawn?: Range;
  className?: string;
}

interface Spark {
  x: number;
  y: number;
  vy: number;
  phase: number;
  sway: number;
  life: number;
  rate: number;
  size: number;
}

function seed(index: number, salt: number): number {
  const n = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function between([low, high]: [number, number], t: number): number {
  return low + (high - low) * t;
}

function newSpark(index: number, t: number, spawn: Range): Spark {
  return {
    x: between(spawn.x, seed(index, t)),
    y: between(spawn.y, seed(index, t + 1)),
    vy: 0.03 + seed(index, t + 2) * 0.03,
    phase: seed(index, t + 3) * Math.PI * 2,
    sway: 0.01 + seed(index, t + 4) * 0.02,
    life: 0,
    rate: 0.09 + seed(index, t + 5) * 0.08,
    size: 0.5 + seed(index, t + 6) * 0.9,
  };
}

const DEFAULT_SPAWN: Range = { x: [0.1, 0.9], y: [0.5, 0.95] };

export function SparkField({ count = 28, spawn = DEFAULT_SPAWN, className = "" }: SparkFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(
    function mount() {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        return;
      }
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      const total = coarse ? Math.round(count * 0.6) : count;

      const sparks: Spark[] = [];
      for (let i = 0; i < total; i += 1) {
        const spark = newSpark(i, 0, spawn);
        spark.life = seed(i, 9);
        sparks.push(spark);
      }

      function resize(): void {
        const rect = canvas!.getBoundingClientRect();
        canvas!.width = Math.max(1, Math.round(rect.width));
        canvas!.height = Math.max(1, Math.round(rect.height));
      }
      resize();

      let frame = 0;
      let visible = true;
      let last = performance.now();
      let t = 0;

      function paint(dt: number): void {
        t += dt;
        const w = canvas!.width;
        const h = canvas!.height;
        ctx!.clearRect(0, 0, w, h);
        ctx!.globalCompositeOperation = "lighter";
        sparks.forEach(function draw(spark, i): void {
          spark.life += dt * spark.rate;
          spark.y -= spark.vy * dt;
          if (spark.life >= 1) {
            sparks[i] = newSpark(i, t, spawn);
            return;
          }
          const fade = Math.sin(spark.life * Math.PI);
          const x = (spark.x + Math.sin(t * 1.3 + spark.phase) * spark.sway) * w;
          const y = spark.y * h;
          const r = spark.size * (0.7 + fade * 0.5);
          ctx!.beginPath();
          ctx!.arc(x, y, r * 2.6, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(190, 255, 120, ${0.12 * fade})`;
          ctx!.fill();
          ctx!.beginPath();
          ctx!.arc(x, y, r, 0, Math.PI * 2);
          ctx!.fillStyle = `rgba(236, 255, 200, ${0.9 * fade})`;
          ctx!.fill();
        });
        ctx!.globalCompositeOperation = "source-over";
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
      resizeObserver.observe(canvas);
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
      intersection.observe(canvas);
      paint(0);
      if (!reduced) frame = requestAnimationFrame(tick);

      return function unmount(): void {
        if (frame) cancelAnimationFrame(frame);
        resizeObserver.disconnect();
        intersection.disconnect();
      };
    },
    [count, spawn],
  );

  return <canvas ref={canvasRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} />;
}
