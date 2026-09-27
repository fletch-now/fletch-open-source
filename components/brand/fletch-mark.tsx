import Image from "next/image";

// Brand mark: the final render (public/brand/final-logo.png), used everywhere
// the old vector path was — headers, footer, console, integration tiles. One
// component so every placement shows the same file.

interface FletchMarkProps {
  size?: number;
  className?: string;
}

export function FletchMark({ size = 20, className }: FletchMarkProps) {
  return (
    <Image
      src="/brand/final-logo.png"
      alt=""
      width={size}
      height={Math.round((size * 1292) / 1218)}
      className={className}
      aria-hidden="true"
    />
  );
}

interface WordmarkProps {
  className?: string;
}

export function Wordmark({ className }: WordmarkProps) {
  return (
    <span className={`flex items-center gap-2 ${className ?? ""}`}>
      <FletchMark size={17} className="text-hood" />
      {/* The word inherits colour so the header can tint it; the mark is the
          final render and keeps its own. */}
      <span className="display text-[20px] tracking-[-0.04em]">Fletch</span>
    </span>
  );
}

// Decor: a single ballistic arc — the path an arrow takes. Used once, behind the
// hero, as a signature line rather than a repeating pattern.
export function TrajectoryArc({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 300"
      fill="none"
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M -20 280 C 300 30, 900 30, 1220 280"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="3 7"
        opacity="0.5"
      />
    </svg>
  );
}

// Decor: a small vane used in place of a bullet.
export function Vane({ className }: { className?: string }) {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M21.2 1.0 L17.5 7.8 L16.6 11.7 L16.6 14.0 L17.3 16.6 L11.0 16.8 L9.9 18.0 L7.8 19.7 L4.8 23.0 L4.5 21.6 L4.9 18.2 L6.2 14.9 L7.3 13.3 L7.3 11.4 L6.4 11.2 L2.8 11.0 L2.9 10.5 L4.0 9.1 L5.3 8.3 L8.2 6.4 L10.1 5.3 L11.6 4.2 L13.1 3.4 L17.7 1.7 Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
