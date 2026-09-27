import { DISCOVERY_SCOPE, tokenDiscoveries } from "@/lib/registry/discoveries";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";

export const dynamic = "force-dynamic";

function escapeXml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(): Promise<Response> {
  let discoveries;
  try {
    discoveries = await tokenDiscoveries(RH_MAINNET_ID);
  } catch {
    return new Response("Token discoveries are temporarily unavailable. Try again shortly.", {
      status: 503, headers: { "cache-control": "no-store", "retry-after": "30", "content-type": "text/plain; charset=utf-8" },
    });
  }
  const items = discoveries.items.map(function item(token) {
    const url = `${APP_URL}/registry/markets/${token.address}`;
    const description = `${token.name ?? token.symbol} (${token.symbol}) at ${token.address}. ${token.trust.detail} First recorded by Fletch ${token.firstSeenAt}. Source: ${token.source === "asset_list" ? "asset list" : "contract metadata"}. Metadata checked: ${token.metadataCheckedAt ?? "not yet"}.`;
    return `    <item>
      <title>${escapeXml(`${token.symbol}: ${token.name ?? token.symbol}`)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(token.firstSeenAt).toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
  }).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Fletch token discoveries</title>
    <link>${APP_URL}/registry</link>
    <description>${escapeXml(DISCOVERY_SCOPE)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(discoveries.asOf).toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=15" } });
}
