import type { CardMetric } from "@/lib/og-metrics";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = "image/png";

export interface CardProps {
  title: string;
  subtitle: string;
  metric?: CardMetric | null;
}

// Keep the card legible when a chat compresses it to a small preview. Contract
// addresses belong on the page; each measured metric carries its own timestamp.
export async function brandCard({ title, subtitle, metric }: CardProps): Promise<ImageResponse> {
  const [mark, bold] = await Promise.all([
    readFile(join(process.cwd(), "public", "icon-512.png")),
    readFile(join(process.cwd(), "public", "fonts", "InstrumentSans-Bold.ttf")),
  ]);
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#0c0e0d", padding: "48px 64px", color: "#f6f8f1", position: "relative" }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", background: "linear-gradient(125deg, rgba(0,200,5,0) 45%, rgba(0,200,5,0.3) 100%)" }} />
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Rendered into the PNG by ImageResponse. */}
        <img src={`data:image/png;base64,${mark.toString("base64")}`} width={64} height={64} alt="" style={{ borderRadius: 14 }} />
        <span style={{ fontSize: 44, fontWeight: 700, letterSpacing: -1 }}>Fletch</span>
        <span style={{ marginLeft: "auto", fontSize: 34, color: "#b8cbb9" }}>fletch.now</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <div style={{ display: "flex", width: 100, height: 6, background: "#00c805" }} />
        <div style={{ fontFamily: "Instrument Sans", fontSize: 96, fontWeight: 700, lineHeight: 1.04, letterSpacing: -4, whiteSpace: "pre-wrap" }}>{title}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 40, fontWeight: 500, color: "#d0e1d0", lineHeight: 1.2 }}>{subtitle}</div>
        {metric ? <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 34, color: "#d0e1d0" }}>
          <span>{metric.text}</span><span>{metric.at.toISOString().slice(0, 16).replace("T", " ")} UTC</span>
        </div> : null}
      </div>
    </div>,
    { ...OG_SIZE, headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=60" }, fonts: [{ name: "Instrument Sans", data: bold, weight: 700, style: "normal" }] },
  );
}
