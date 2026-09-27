"use client";

import { useEffect, useRef } from "react";

// The reference's ASCII scene: a slowly rotating (2,3) torus knot drawn as text
// glyphs, depth-mapped so nearer points get denser characters and brighter colour.
// One normalised depth value drives glyph, colour and alpha together, which is why
// it reads as volume rather than as noise.
//
// Ours turns green instead of their green-on-black-panel, and it stops when it
// scrolls away — theirs runs a rAF loop forever, on every page, regardless.

const RAMP = " .:-=+*#%@";
const CELL = 7;

interface Point {
  x: number;
  y: number;
  z: number;
}

// A (p,q) torus knot: the curve winds p times around the torus axis and q times
// through its hole, which is what gives the silhouette its braid.
function torusKnot(segments: number, tube: number): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < segments; i += 1) {
    const u = (i / segments) * Math.PI * 2;
    const p = 2;
    const q = 3;
    const r = 0.6 + 0.28 * Math.cos(q * u);
    const cx = r * Math.cos(p * u);
    const cy = r * Math.sin(p * u);
    const cz = 0.28 * Math.sin(q * u);
    for (let j = 0; j < tube; j += 1) {
      const v = (j / tube) * Math.PI * 2;
      const radius = 0.11;
      points.push({
        x: cx + radius * Math.cos(v) * Math.cos(p * u),
        y: cy + radius * Math.cos(v) * Math.sin(p * u),
        z: cz + radius * Math.sin(v),
      });
    }
  }
  return points;
}

export function AsciiScene({ className = "" }: { className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(function run() {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    // Captured as non-null locals: the observer and listener callbacks below close
    // over these, and TypeScript cannot prove the guards above still hold there.
    const surface = ctx;
    const box = host;
    const target = canvas;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const points = torusKnot(120, 10);
    const pointer = { x: 0.5, y: 0.5 };
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let visible = true;
    let time = 0;

    function resize(): void {
      const bounds = box.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = bounds.width;
      height = bounds.height;
      target.width = Math.floor(width * dpr);
      target.height = Math.floor(height * dpr);
      target.style.width = `${width}px`;
      target.style.height = `${height}px`;
      surface.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw(): void {
      surface.clearRect(0, 0, width, height);
      surface.font = `${CELL + 3}px "JetBrains Mono", ui-monospace, monospace`;
      surface.textBaseline = "middle";
      surface.textAlign = "center";

      // Pointer nudges an already-running rotation rather than replacing it, so the
      // scene never freezes when the cursor is still.
      const yaw = time * 0.34 + (pointer.x - 0.5) * 0.5;
      const pitch = 0.42 + (pointer.y - 0.5) * 0.4;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const scale = Math.min(width, height) * 0.42;
      const cx = width / 2;
      const cy = height / 2;

      for (const point of points) {
        const x1 = point.x * cosY + point.z * sinY;
        const z1 = -point.x * sinY + point.z * cosY;
        const y2 = point.y * cosP - z1 * sinP;
        const z2 = point.y * sinP + z1 * cosP;

        const perspective = 2.6 / (2.6 + z2);
        const px = cx + x1 * scale * perspective;
        const py = cy + y2 * scale * perspective;
        if (px < -CELL || px > width + CELL || py < -CELL || py > height + CELL) {
          continue;
        }

        // One depth value drives all three channels.
        const depth = Math.min(1, Math.max(0, (z2 + 0.9) / 1.8));
        const near = 1 - depth;
        const glyph = RAMP[Math.min(RAMP.length - 1, Math.floor(near * RAMP.length))];
        if (glyph === " ") {
          continue;
        }
        const green = 140 + Math.floor(near * 115);
        surface.fillStyle = `rgba(${Math.floor(near * 90)}, ${green}, ${110 + Math.floor(near * 60)}, ${0.18 + near * 0.62})`;
        surface.fillText(glyph, px, py);
      }
    }

    function tick(): void {
      time += reduced ? 0 : 0.016;
      draw();
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
    }

    function onPointer(event: PointerEvent): void {
      const bounds = box.getBoundingClientRect();
      pointer.x = (event.clientX - bounds.left) / bounds.width;
      pointer.y = (event.clientY - bounds.top) / bounds.height;
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
    window.addEventListener("pointermove", onPointer, { passive: true });
    frame = requestAnimationFrame(tick);

    return function stop() {
      if (frame) {
        cancelAnimationFrame(frame);
      }
      resizeObserver.disconnect();
      intersection.disconnect();
      window.removeEventListener("pointermove", onPointer);
    };
  }, []);

  return (
    <div ref={hostRef} aria-hidden="true" className={`absolute inset-0 ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
