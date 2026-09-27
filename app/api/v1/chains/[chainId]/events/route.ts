// GET /api/v1/chains/:chainId/events — the registry changelog as JSON: every
// pause, block, upgrade, multiplier change, stale feed, residual, listing and
// chain status change the daemon recorded. `kind` filters exactly or by prefix
// ("registry.", "multiplier."); `symbol` narrows to one token; `since` (ISO)
// or `cursor` returns only newer rows, oldest first, for a consumer catching up.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { cursorText, parseCursorParam } from "@/lib/api/cursor";
import { parseLimit } from "@/lib/api/params";
import { RH_MAINNET_ID } from "@/lib/config";
import { AUTHORITY_EVENT_KINDS } from "@/lib/registry/authority/events";
import { authorityEventsAfter, eventCursorOf, recentAuthorityEvents } from "@/lib/registry/authority/read";
import { publicAuthorityEvent } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

const MAX_LIMIT = 500;
const MAX_AGE_SECONDS = 10;

// The cursor handed out when the changelog is empty: passed back, it yields
// every event from the first, so a consumer that started before any event
// was written misses none. A clock reading here would change the body, and
// so the ETag, on every request.
const EPOCH_CURSOR = new Date(0).toISOString();

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/events">): Promise<Response> {
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
  const limit = parseLimit(params.get("limit"), 100, MAX_LIMIT);
  const kind = params.get("kind") ?? undefined;
  const symbol = params.get("symbol")?.toUpperCase() ?? undefined;
  const { cursor, error } = parseCursorParam(params.get("since") ?? params.get("cursor"));
  if (error) {
    return publicJson(400, { error });
  }

  if (cursor) {
    const events = await authorityEventsAfter(chainId, cursor, limit);
    const last = events[events.length - 1];
    return cachedJson(request, {
      events: events.map(publicAuthorityEvent),
      // An instant plus the last id seen at it; pass it back verbatim.
      nextCursor: last ? eventCursorOf(last) : cursorText(cursor),
    }, MAX_AGE_SECONDS);
  }
  const events = await recentAuthorityEvents(chainId, { kind, symbol, limit });
  return cachedJson(request, {
    events: events.map(publicAuthorityEvent),
    kinds: AUTHORITY_EVENT_KINDS,
    // Pass this back as `cursor` to receive only what follows.
    nextCursor: events[0] ? eventCursorOf(events[0]) : EPOCH_CURSOR,
  }, MAX_AGE_SECONDS);
}
