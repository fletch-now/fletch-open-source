import Image from "next/image";
import { SparkField } from "@/components/landing/spark-field";

// Two brand renders on the night sections, each with the same rising sparks the
// hero gives its arrow, so the three read as one family.
//
// The connection: hands over the chain's current (the v2 render). Shown whole
// and edge to edge at every width, never cropped. Served at 1672px through the
// image pipeline at quality 90 with per-width variants, so a wide retina screen
// gets a large asset and a phone a small one.
//
// The ledge: an overhang that enters from the right and is cut off there, so it
// is anchored to the right edge of whatever section holds it.

// Spawn boxes are module constants: the spark canvas re-seeds when this object
// changes identity, and an inline literal would change it every render.
const CONNECTION_SPAWN = { x: [0.22, 0.78] as [number, number], y: [0.45, 0.95] as [number, number] };
const LEDGE_SPAWN = { x: [0.3, 0.95] as [number, number], y: [0.35, 0.9] as [number, number] };

export function ConnectionBand() {
  return (
    <div className="relative w-full" aria-hidden="true">
      <Image
        src="/brand/final-hands.png"
        alt=""
        width={2132}
        height={738}
        quality={90}
        sizes="100vw"
        className="block h-auto w-full select-none"
      />
      <SparkField count={30} spawn={CONNECTION_SPAWN} />
    </div>
  );
}

export function LedgeFigure() {
  return (
    <div className="relative" aria-hidden="true">
      <Image
        src="/brand/ledge.webp"
        alt=""
        width={1536}
        height={1024}
        unoptimized
        className="block h-auto w-full select-none"
      />
      <SparkField count={26} spawn={LEDGE_SPAWN} />
    </div>
  );
}
