// GET /api/v1/watchers/:id/runs — one watcher's delivery history: every matched
// event, when it was seen, when it sent, or why it failed. The dashboard's
// watcher detail page and this route both read lib/watch/queries.ts so they can
// never disagree about what happened.

import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { getWatcherForUser, listDeliveriesForWatcher } from "@/lib/watch/queries";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function parseLimit(request: Request): number {
  const raw = new URL(request.url).searchParams.get("limit");
  const parsed = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }
  return Math.min(Math.trunc(parsed), MAX_LIMIT);
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/watchers/[id]/runs">,
): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;

  // Ownership check up front: listDeliveriesForWatcher is scoped by userId too
  // and would just return an empty array for someone else's watcher, but a 404
  // is the more honest answer to "does this watcher exist" than a silent [].
  const watcher = await getWatcherForUser(actor.userId, id);
  if (!watcher) {
    return json(404, { error: "Not found" });
  }

  const runs = await listDeliveriesForWatcher(actor.userId, id, parseLimit(request));
  return json(200, { runs });
}
