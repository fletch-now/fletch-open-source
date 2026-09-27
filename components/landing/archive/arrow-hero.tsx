"use client";

import dynamic from "next/dynamic";

// Three.js and the bloom passes are ~700 KB; they load after the page paints, so the
// headline and the console are interactive before the monument appears.
export const ArrowHero = dynamic(
  function load() {
    return import("@/components/landing/archive/arrow-monument-procedural").then(function pick(m) {
      return { default: m.ArrowMonument };
    });
  },
  { ssr: false },
);
