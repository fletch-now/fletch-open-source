"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Scroll-triggered entrance, the reference codebase's most-used effect. It reveals
// once and then stops observing — a section that re-animates every time it scrolls
// back into view reads as a gimmick rather than as arrival.
//
// The class is toggled directly on the node instead of through state: this drives
// one CSS transition and nothing else, so a re-render would be pure waste.

interface RevealProps {
  children: ReactNode;
  className?: string;
  // Staggers siblings. Kept small — past ~120ms per item it feels like waiting.
  delayMs?: number;
}

export function Reveal({ children, className = "", delayMs = 0 }: RevealProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(function revealOnce() {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      host.classList.add("revealed");
      return;
    }
    const observer = new IntersectionObserver(
      function onEnter(entries) {
        if (entries[0].isIntersecting) {
          host.classList.add("revealed");
          observer.disconnect();
        }
      },
      // Fires a little before the block is fully on screen, so the motion has
      // finished by the time the reader's eye arrives.
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(host);
    return function stop() {
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={hostRef} className={`reveal ${className}`} style={{ transitionDelay: `${delayMs}ms` }}>
      {children}
    </div>
  );
}
