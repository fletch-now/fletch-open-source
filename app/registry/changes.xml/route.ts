// The registry changelog as Atom: every authority event, newest first. The
// same rows the JSON endpoint and the SSE stream serve, for readers that
// subscribe to feeds.

import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { recentAuthorityEvents } from "@/lib/registry/authority/read";

export const dynamic = "force-dynamic";

const FEED_LIMIT = 100;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const events = await recentAuthorityEvents(RH_MAINNET_ID, {
    kind: params.get("kind") ?? undefined,
    symbol: params.get("symbol")?.toUpperCase() ?? undefined,
    limit: FEED_LIMIT,
  }).catch(function unavailable() {
    return [];
  });
  const updated = events[0]?.observedAt ?? new Date();
  const entries = events
    .map(function entry(event) {
      const link = event.symbol ? `${APP_URL}/registry/${encodeURIComponent(event.symbol)}` : `${APP_URL}/registry/changes`;
      const summary = `${event.kind}${event.txHash ? ` · tx ${event.txHash}` : ""}${event.blockNumber !== null ? ` · block ${event.blockNumber}` : ""}`;
      return `  <entry>
    <id>urn:fletch:event:${event.id}</id>
    <title>${escapeXml(event.title)}</title>
    <link href="${link}"/>
    <updated>${event.observedAt.toISOString()}</updated>
    <published>${event.occurredAt.toISOString()}</published>
    <category term="${escapeXml(event.kind)}"/>
    <summary>${escapeXml(summary)}</summary>
  </entry>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Robinhood Chain registry changelog</title>
  <subtitle>Pauses, upgrades, blocks, multiplier changes, stale feeds, supply residuals, listings and chain status, as Fletch's registry daemon recorded them.</subtitle>
  <link href="${APP_URL}/registry/changes"/>
  <link rel="self" href="${APP_URL}/registry/changes.xml"/>
  <id>${APP_URL}/registry/changes</id>
  <updated>${updated.toISOString()}</updated>
${entries}
</feed>
`;
  return new Response(xml, { headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=60" } });
}
