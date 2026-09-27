"use client";

// A whale, drifting. In this world a whale is a wallet big enough to move a market,
// and one of the four things people build here is a watcher that follows them — so
// it is the section's subject rather than decoration bolted on.
//
// Drawn as one SVG path so it stays crisp at any size, moved with a transform-only
// keyframe so it composites on the GPU, and stilled entirely under reduced motion.

export function Whale({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none overflow-hidden ${className}`}>
      <div className="whale-swim absolute top-0 h-full">
        <svg
          viewBox="0 0 220 110"
          fill="none"
          className="whale-bob h-full w-auto text-hood"
          role="presentation"
        >
          {/* Body: a long taper from the blunt head to the peduncle. */}
          <path
            d="M12 62c14-26 44-40 78-40 30 0 54 11 68 27 6 7 14 11 22 12l-14 12c-8 1-16 5-22 12-14 16-38 27-68 27-34 0-64-14-78-40-2-4-2-6 0-10Z"
            fill="currentColor"
            fillOpacity="0.1"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* Fluke. */}
          <path
            d="M180 61c9-9 20-15 32-16-6 6-9 11-9 16s3 10 9 16c-12-1-23-7-32-16Z"
            fill="currentColor"
            fillOpacity="0.16"
            stroke="currentColor"
            strokeOpacity="0.55"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          {/* Pectoral fin. */}
          <path
            d="M84 74c8 10 18 16 29 17-7-6-11-12-12-19Z"
            fill="currentColor"
            fillOpacity="0.22"
            stroke="currentColor"
            strokeOpacity="0.5"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          {/* Ventral pleats — the detail that makes the silhouette read as a whale
              rather than as a fish. */}
          <path
            d="M40 74c14 5 30 8 46 8M46 82c12 4 26 6 40 6"
            stroke="currentColor"
            strokeOpacity="0.3"
            strokeWidth="1.1"
            strokeLinecap="round"
          />
          <circle cx="36" cy="52" r="2.4" fill="currentColor" fillOpacity="0.85" />
          {/* Blowhole spout. */}
          <path
            d="M62 22c0-6 3-11 7-14M62 22c-4-5-4-11-2-15"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
}
