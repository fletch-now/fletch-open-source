// GET /api/v1/chains/:chainId/events/stream — the changelog as Server-Sent
// Events. Each frame's id is the event's cursor, `${observedAt}|${id}`, so a
// client that reconnects with Last-Event-ID (or ?since=) misses nothing. The
// table is polled every two seconds; that is the daemon's own cadence for
// most jobs.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { CORS_HEADERS, publicDenied, publicJson } from "@/lib/api/etag";
import { cursorText, parseCursorParam } from "@/lib/api/cursor";
import { RH_MAINNET_ID } from "@/lib/config";
import { clientIp } from "@/lib/ratelimit";
import { authorityEventsAfter, eventCursorOf } from "@/lib/registry/authority/read";
import { publicAuthorityEvent } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

export const dynamic = "force-dynamic";

// Open streams per address and in total: each one polls the database every
// two seconds for up to half an hour, and the read rate limit only counts
// openings. Kept in this process; a second process would keep its own.
const MAX_STREAMS_PER_IP = 5;
const MAX_STREAMS_TOTAL = 200;
const openByIp = new Map<string, number>();
let openTotal = 0;

function acquire(ip: string): boolean {
  const mine = openByIp.get(ip) ?? 0;
  if (mine >= MAX_STREAMS_PER_IP || openTotal >= MAX_STREAMS_TOTAL) {
    return false;
  }
  openByIp.set(ip, mine + 1);
  openTotal += 1;
  return true;
}

function release(ip: string): void {
  const mine = (openByIp.get(ip) ?? 1) - 1;
  if (mine <= 0) {
    openByIp.delete(ip);
  } else {
    openByIp.set(ip, mine);
  }
  openTotal = Math.max(0, openTotal - 1);
}

const POLL_MS = 2_000;
const KEEPALIVE_MS = 20_000;
// Long enough for a subscriber, short enough that a forgotten tab frees its
// database poll; clients reconnect with Last-Event-ID.
const MAX_LIFETIME_MS = 30 * 60_000;

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/events/stream">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  const params = new URL(request.url).searchParams;
  const position = parseCursorParam(request.headers.get("last-event-id") ?? params.get("since"));
  if (position.error) {
    return publicJson(400, { error: position.error });
  }
  const ip = clientIp(request.headers);
  if (!acquire(ip)) {
    return publicJson(429, { error: "Too many open streams from this address; close one or poll /events with a cursor." });
  }
  // With no position the stream starts at now.
  let cursor = position.cursor ?? { after: new Date(), afterId: null };
  const encoder = new TextEncoder();
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastKeepalive = Date.now();
      controller.enqueue(encoder.encode(`: fletch registry events, chain ${chainId}\n\n`));
      // An id-only frame sets the client's lastEventId without dispatching an
      // event, so a reconnect carries a position even if no event arrived;
      // `retry` tells EventSource to reconnect at the poll cadence.
      controller.enqueue(encoder.encode(`retry: ${POLL_MS}\nid: ${cursorText(cursor)}\n\n`));
      async function tick(): Promise<boolean> {
        if (request.signal.aborted || Date.now() - startedAt > MAX_LIFETIME_MS) {
          return false;
        }
        const events = await authorityEventsAfter(chainId, cursor);
        for (const event of events) {
          const frame = `id: ${eventCursorOf(event)}\nevent: ${event.kind}\ndata: ${JSON.stringify(publicAuthorityEvent(event))}\n\n`;
          controller.enqueue(encoder.encode(frame));
          cursor = { after: event.observedAt, afterId: event.id };
        }
        if (Date.now() - lastKeepalive > KEEPALIVE_MS) {
          controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ checkedAt: new Date().toISOString() })}\n\n`));
          lastKeepalive = Date.now();
        }
        return true;
      }
      try {
        while (await tick()) {
          await new Promise(function wait(resolve) {
            setTimeout(resolve, POLL_MS);
          });
        }
      } catch {
        // Closing the stream makes source failures visible to reconnecting clients.
      } finally {
        release(ip);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...CORS_HEADERS,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
