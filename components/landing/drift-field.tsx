"use client";

import { useEffect, useRef } from "react";

// A slow drift of chain debris behind the light sections: mostly motes, with the
// occasional fragment of something real — an RPC method, the pinned compiler, a
// chain id. Kept faint and slow on purpose; it is texture, not an animation people
// are meant to watch.

const FRAGMENTS = [
  "eth_call",
  "0x7a2f…",
  "0.8.28",
  "46630",
  "eth_getLogs",
  "0xdE0B…",
  "forge test",
  "4663",
  "0x00…c805",
  "eth_chainId",
];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  text: string | null;
}

export function DriftField({ className = "", density = 26 }: { className?: string; density?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(
    function run() {
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas) {
        return;
      }
      const context = canvas.getContext("2d");
      if (!context) {
        return;
      }
      const ctx = context;
      const box = host;
      const surface = canvas;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let width = 0;
      let height = 0;
      let motes: Mote[] = [];
      let frame = 0;
      let visible = true;

      function seed(): void {
        motes = [];
        for (let i = 0; i < density; i += 1) {
          // Deterministic placement from the golden ratio: stable between renders
          // and needs no random(), which would jump on every resize.
          const a = ((i * 0.618033) % 1);
          const b = ((i * 0.381966) % 1);
          const isText = i % 5 === 0;
          motes.push({
            x: a * width,
            y: b * height,
            vx: (0.12 + ((i * 7) % 10) / 90) * (i % 2 === 0 ? 1 : -1),
            vy: -0.05 - ((i * 3) % 7) / 220,
            size: isText ? 10 : 1 + ((i * 5) % 3) * 0.6,
            alpha: isText ? 0.16 : 0.2 + ((i * 11) % 5) / 22,
            text: isText ? FRAGMENTS[i % FRAGMENTS.length] : null,
          });
        }
      }

      function resize(): void {
        const bounds = box.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        width = bounds.width;
        height = bounds.height;
        surface.width = Math.floor(width * dpr);
        surface.height = Math.floor(height * dpr);
        surface.style.width = `${width}px`;
        surface.style.height = `${height}px`;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        seed();
      }

      function draw(): void {
        ctx.clearRect(0, 0, width, height);
        ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
        for (const mote of motes) {
          if (!reduced) {
            mote.x += mote.vx;
            mote.y += mote.vy;
            // Wrap rather than respawn, so density never visibly changes.
            if (mote.x < -60) mote.x = width + 60;
            if (mote.x > width + 60) mote.x = -60;
            if (mote.y < -20) mote.y = height + 20;
          }
          if (mote.text) {
            ctx.fillStyle = `rgba(1, 118, 14, ${mote.alpha})`;
            ctx.fillText(mote.text, mote.x, mote.y);
            continue;
          }
          ctx.fillStyle = `rgba(1, 118, 14, ${mote.alpha})`;
          ctx.beginPath();
          ctx.arc(mote.x, mote.y, mote.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      function tick(): void {
        draw();
        frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
      }

      const resizeObserver = new ResizeObserver(function onResize() {
        resize();
        draw();
      });
      const intersection = new IntersectionObserver(function onCross(entries) {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible && !frame) {
          frame = requestAnimationFrame(tick);
        }
        if (!visible && frame) {
          cancelAnimationFrame(frame);
          frame = 0;
        }
      });

      resize();
      resizeObserver.observe(box);
      intersection.observe(box);
      if (reduced) {
        draw();
      } else {
        frame = requestAnimationFrame(tick);
      }

      return function stop() {
        if (frame) {
          cancelAnimationFrame(frame);
        }
        resizeObserver.disconnect();
        intersection.disconnect();
      };
    },
    [density],
  );

  return (
    <div ref={hostRef} aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
