import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPublicApp } from "@/lib/apps/directory";
import { appHue } from "@/lib/apps/presentation";
import { OG_SIZE } from "@/lib/og";
import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { publicDenied } from "@/lib/api/etag";

export const dynamic = "force-dynamic";

const images = new Map<string, Uint8Array>();
let bytes = 0;
let rendering = 0;
const MAX_BYTES = 16 * 1024 * 1024;

export async function GET(
  request: Request,
  context: RouteContext<"/published/[slug]/opengraph-image">,
): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const app = await getPublicApp((await context.params).slug);
  if (!app)
    return new Response("App not found.", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  // Visibility is checked before the byte cache, so an unlist revokes image
  // access immediately. Bound image memory and concurrent CPU work separately.
  const key = `${app.slug}:${app.updatedAt}`;
  const headers = { "Content-Type": "image/png", "Cache-Control": "no-store" };
  const cached = images.get(key);
  if (cached) return new Response(cached as BodyInit, { headers });
  if (rendering >= 2)
    return new Response("Share image is being prepared. Try again shortly.", {
      status: 503,
      headers: { "Retry-After": "2", "Cache-Control": "no-store" },
    });
  rendering++;
  try {
    const font = await readFile(
      join(process.cwd(), "public/fonts/InstrumentSans-Bold.ttf"),
    );
    const hue = appHue(app.slug);
    const image = new ImageResponse(
      (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: "100%",
            height: "100%",
            padding: 64,
            background: `hsl(${hue} 35% 92%)`,
            color: "#0e100f",
            fontFamily: "Instrument Sans",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: 28,
            }}
          >
            <span>Fletch / published</span>
            <span>App directory · Beta</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                fontSize: app.title.length > 35 ? 62 : 82,
                lineHeight: 1.06,
                letterSpacing: -2,
                overflowWrap: "break-word",
              }}
            >
              {app.title}
            </div>
            <div style={{ fontSize: 32, lineHeight: 1.4, color: "#37473d" }}>
              {app.summary}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 24,
            }}
          >
            <span>
              {app.token
                ? `${app.token.symbol} · ${app.token.chainId === 46630 ? "Testnet" : "Mainnet"}`
                : "Built with Fletch"}
            </span>
            <span>fletch.now/published</span>
          </div>
        </div>
      ),
      {
        ...OG_SIZE,
        fonts: [
          { name: "Instrument Sans", data: font, weight: 700, style: "normal" },
        ],
        headers: { "Cache-Control": "no-store" },
      },
    );
    const body = new Uint8Array(await image.arrayBuffer());
    while (
      images.size &&
      (bytes + body.byteLength > MAX_BYTES || images.size >= 64)
    ) {
      const oldest = images.keys().next().value!;
      bytes -= images.get(oldest)!.byteLength;
      images.delete(oldest);
    }
    if (body.byteLength <= MAX_BYTES && !images.has(key)) {
      images.set(key, body);
      bytes += body.byteLength;
    }
    return new Response(body, { headers });
  } finally {
    rendering--;
  }
}
