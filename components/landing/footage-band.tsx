"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";
import { Reveal } from "@/components/landing/reveal";
import { Eyebrow } from "@/components/landing/kit";

// The cherry-tree footage, moved out of the hero into its own band lower on the page.
// Here it is atmosphere behind one sentence, so the scrim is heavy and the type sits
// on near-black regardless of which frame is under it. The video only attaches once
// the band is on screen, and phones keep the still.

export function FootageBand() {
  const hostRef = useRef<HTMLElement>(null);
  const inView = useInView(hostRef, { amount: 0.2 });
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(
    function attach() {
      if (!inView || src) {
        return;
      }
      const narrow = window.matchMedia("(max-width: 767px)").matches;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
      if (narrow || reduced || connection?.saveData) {
        return;
      }
      const timer = window.setTimeout(function load() {
        setSrc("/hero.mp4");
      }, 200);
      return function cancel() {
        window.clearTimeout(timer);
      };
    },
    [inView, src],
  );

  return (
    <section ref={hostRef} className="relative overflow-hidden bg-[#060708] text-white">
      <div aria-hidden="true" className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- must match the video's first frame exactly */}
        <img
          src="/hero-poster.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover object-center opacity-70"
        />
        {src ? (
          <video
            autoPlay
            muted
            loop
            playsInline
            preload="none"
            poster="/hero-poster.jpg"
            onPlaying={function reveal() {
              setPlaying(true);
            }}
            className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-700 ${
              playing ? "opacity-70" : "opacity-0"
            }`}
          >
            <source src={src} type="video/mp4" />
          </video>
        ) : null}
        {/* Heavy on the left where the copy sits, so contrast never depends on the frame. */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/20" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/70" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 py-24 sm:px-6 lg:py-32">
        <Reveal className="max-w-2xl">
          <Eyebrow onDark className="mb-7">
            somewhere to live
          </Eyebrow>
          <h2 className="display text-balance text-[clamp(2.2rem,6vw,4.6rem)] leading-[0.92] tracking-[-0.03em] text-white">
            A chat window forgets you
            <span className="block text-white/60">the moment you close it.</span>
          </h2>
          <p className="mt-7 max-w-xl text-[16px] leading-8 text-white/[0.82]">
            Every build is kept against your wallet, with its files, compiler report,
            and test results. Set a threshold on a verified asset. Fletch keeps
            watching after you close the tab.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
