"use client";

import { useEffect, useRef, type ReactNode } from "react";

// The night band. Owns one piece of behaviour: whether it is on screen, so the
// drifting motes stop animating when nobody can see them. A full-bleed animated
// layer that keeps compositing while the user reads the page below is wasted
// battery on every device.
//
// The flag is written straight to the DOM rather than held in state — it drives
// nothing but a CSS selector, and routing it through React would re-render the
// entire hero, console included, every time the section crosses the viewport.

export function HeroSection({ children }: { children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(function watchVisibility() {
    const section = sectionRef.current;
    if (!section) {
      return;
    }
    const observer = new IntersectionObserver(
      function onChange(entries) {
        section.dataset.heroVisible = entries[0].isIntersecting ? "true" : "false";
      },
      { threshold: 0 },
    );
    observer.observe(section);
    return function stop() {
      observer.disconnect();
    };
  }, []);

  return (
    // overflow-clip rather than hidden: it clips the motes' bleed without creating
    // a scroll container, so scroll-mt on the sibling sections still works.
    <section
      ref={sectionRef}
      data-hero-visible="true"
      className="hero-night relative flex min-h-[110svh] flex-col justify-center overflow-clip"
    >
      {children}
    </section>
  );
}
