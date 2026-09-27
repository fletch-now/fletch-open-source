"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./night-shift.module.css";

export function NightShiftVideo() {
  const hostRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playbackPreference = useRef<boolean | null>(null);
  const syncPlayback = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(function observePlayback() {
    const host = hostRef.current;
    const video = videoRef.current;
    if (!host || !video) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean } }).connection;
    let visible = false;

    function sync() {
      const requested = playbackPreference.current ?? (!reducedMotion.matches && !connection?.saveData);
      if (visible && !document.hidden && requested) {
        // Assign the source only when needed. A manual play stays inside the
        // click gesture, including on browsers that restrict autoplay.
        if (!video!.getAttribute("src")) video!.src = "/video/night-shift.mp4";
        if (video!.paused) void video!.play().catch(() => {});
      } else {
        video!.pause();
      }
    }

    syncPlayback.current = sync;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.intersectionRatio >= 0.15;
      sync();
    }, { threshold: [0, 0.15] });
    observer.observe(host);
    reducedMotion.addEventListener("change", sync);
    connection?.addEventListener("change", sync);
    document.addEventListener("visibilitychange", sync);

    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", sync);
      connection?.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", sync);
      syncPlayback.current = null;
      video.pause();
    };
  }, []);

  function togglePlayback() {
    playbackPreference.current = !playing;
    syncPlayback.current?.();
  }

  return (
    <div ref={hostRef} className={styles.film}>
      {/* eslint-disable-next-line @next/next/no-img-element -- precompressed poster matches the local video's first frame */}
      <img src="/video/night-shift.webp" alt="" width={1280} height={960} loading="lazy" decoding="async" className={styles.poster} />
      <video
        id="night-shift-film"
        ref={videoRef}
        poster="/video/night-shift.webp"
        width={1280}
        height={960}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        className={styles.video}
        onPlay={() => { setPlaying(true); syncPlayback.current?.(); }}
        onPause={() => setPlaying(false)}
        onError={() => { setFailed(true); setPlaying(false); }}
      />
      <button
        type="button"
        className={styles.playback}
        aria-controls="night-shift-film"
        aria-label={failed ? "Film unavailable" : playing ? "Pause the Night Shift film" : "Play the Night Shift film"}
        disabled={failed}
        onClick={togglePlayback}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M3 2h3v12H3zm7 0h3v12h-3z" /> : <path d="m4 2 10 6-10 6z" />}
        </svg>
        {failed ? "Film unavailable" : playing ? "Pause film" : "Play film"}
      </button>
    </div>
  );
}
