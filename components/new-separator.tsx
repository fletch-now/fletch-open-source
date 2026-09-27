// The edge between a paper section and a night section: a straight seam with a
// one-pixel grey line at low opacity, so the change from paper to black reads as
// a deliberate edge rather than a hard cut. Same line on both edges of a night
// section; `edge` only documents which one it is.

interface SeparatorProps {
  edge: "top" | "bottom";
  className?: string;
}

export function Separator({ edge, className = "" }: SeparatorProps) {
  return <div aria-hidden="true" data-edge={edge} className={`h-px w-full bg-[rgb(120_128_118/0.35)] ${className}`} />;
}
