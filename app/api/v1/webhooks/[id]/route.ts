import { WatchLimitError } from "@/lib/watch/capacity";
// PATCH/DELETE /api/v1/webhooks/{id} — enable, disable, rotate the signing
// secret, or remove an endpoint. Deleting one pauses the watchers that were
// delivering to it; the response says how many.

import { z } from "zod";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { hasJsonBody } from "@/lib/api/params";
import { recordAudit } from "@/lib/audit";
import {
  deleteWebhookEndpoint,
  updateWebhookEndpoint,
  WebhookNotFoundError,
} from "@/lib/watch/webhooks";

const PatchWebhookSchema = z.object({
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

// One rejection, written once: a body with neither field asks for nothing.
const NOTHING_TO_CHANGE = "Send enabled, rotateSecret, or both.";

export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]">): Promise<Response> {
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
  const parsed = PatchWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { error: NOTHING_TO_CHANGE });
  }

  try {
    if (parsed.data.enabled === undefined && parsed.data.rotateSecret !== true) {
      return json(400, { error: NOTHING_TO_CHANGE });
    }
    const webhook = await updateWebhookEndpoint(actor.userId, id, parsed.data);
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: parsed.data.rotateSecret ? "webhook.rotate" : "webhook.update",
      resourceType: "webhook",
      resourceId: id,
    });
    return json(200, { webhook });
  } catch (error) {
    if (error instanceof WatchLimitError) {
      return json(409, { error: error.message });
    }
    if (error instanceof WebhookNotFoundError) {
      return json(404, { error: error.message });
    }
    throw error;
  }
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]">): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:write");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const { id } = await ctx.params;

  try {
    const { pausedWatchers } = await deleteWebhookEndpoint(actor.userId, id);
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "webhook.delete",
      resourceType: "webhook",
      resourceId: id,
    });
    return json(200, { ok: true, pausedWatchers });
  } catch (error) {
    if (error instanceof WatchLimitError) {
      return json(409, { error: error.message });
    }
    if (error instanceof WebhookNotFoundError) {
      return json(404, { error: error.message });
    }
    throw error;
  }
}
