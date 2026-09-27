"use client";

import dynamic from "next/dynamic";

// Three.js is ~150 KB gzipped. It loads after the page has painted, never during
// SSR, and the dark ground beneath it means nothing flashes while it arrives.
const ForestScene = dynamic(
  function load() {
    return import("@/components/landing/archive/forest-scene").then(function pick(m) {
      return m.ForestScene;
    });
  },
  { ssr: false },
);

export function ForestHero() {
  return <ForestScene />;
}
