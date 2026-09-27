// GET/PATCH/DELETE /api/v1/watchers/:id — one watcher, key- or session-scoped to
// its owner. Mirrors app/api/watchers/[id]/route.ts's PATCH/DELETE, plus a GET
// the dashboard route doesn't need (the dashboard reads the list/detail pages
// server-side; a v1 client has no session to do that with).

import { z } from "zod";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { hasJsonBody } from "@/lib/api/params";
import { recordAudit } from "@/lib/audit";
import {
  deleteWatcher,
  InvalidDeliveryError,
  updateWatcher,
  WatchLimitError,
  WatchNotFoundError,
} from "@/lib/watch/create";
import { getWatcherForUser } from "@/lib/watch/queries";

// webhookId re-points a watcher: an endpoint id sends its alerts there, null
// sends them back to Telegram. It is the only way to rescue a watcher whose
// endpoint was deleted, which cannot be resumed as it stands.
const PatchWatcherSchema = z.object({
  enabled: z.boolean().optional(),
  webhookId: z.string().trim().min(1).max(64).nullable().optional(),
});

function auditAction(patch: z.infer<typeof PatchWatcherSchema>): string {
  if (patch.enabled === undefined) {
    return "watcher.repoint";
  }
  return patch.enabled ? "watcher.enable" : "watcher.disable";
}

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/watchers/[id]">,
): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;
  const watcher = await getWatcherForUser(actor.userId, id);
  if (!watcher) {
    return json(404, { error: "Not found" });
  }
  return json(200, { watcher });
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<"/api/v1/watchers/[id]">,
): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:write");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;

  if (!hasJsonBody(request)) {
    return json(400, { error: "Send a JSON body with Content-Type: application/json" });
  }
  const body = await request.json().catch(function ignore() {
    return null;
  });
  const parsed = PatchWatcherSchema.safeParse(body);
  if (!parsed.success || (parsed.data.enabled === undefined && parsed.data.webhookId === undefined)) {
    return json(400, { error: "Send enabled, webhookId, or both." });
  }

  try {
    await updateWatcher(actor.userId, id, parsed.data);
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: auditAction(parsed.data),
      resourceType: "watcher",
      resourceId: id,
    });
    const watcher = await getWatcherForUser(actor.userId, id);
    return json(200, { watcher });
  } catch (error) {
    if (error instanceof WatchNotFoundError) {
      return json(404, { error: "Not found" });
    }
    if (error instanceof WatchLimitError) return json(429, { error: error.message });
    if (error instanceof InvalidDeliveryError) {
      return json(400, { error: error.message });
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<"/api/v1/watchers/[id]">,
): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:write");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;

  try {
    await deleteWatcher(actor.userId, id);
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "watcher.delete",
      resourceType: "watcher",
      resourceId: id,
    });
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof WatchNotFoundError) {
      return json(404, { error: "Not found" });
    }
    throw error;
  }
}
