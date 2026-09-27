// GET/POST /api/v1/webhooks — list and register endpoints for watcher alerts.
// The business logic lives in lib/watch/webhooks.ts; the dashboard's Settings
// card calls these same routes with its session cookie.

import { z } from "zod";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { hasJsonBody } from "@/lib/api/params";
import { recordAudit } from "@/lib/audit";
import { logEvent } from "@/lib/log";
import {
  createWebhookEndpoint,
  InvalidWebhookUrlError,
  listWebhookEndpoints,
  WebhookLimitError,
} from "@/lib/watch/webhooks";

const CreateWebhookSchema = z.object({
  url: z.string().trim().min(1).max(2048),
  name: z.string().trim().min(1).max(80).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const webhooks = await listWebhookEndpoints(actor.userId);
  return json(200, { webhooks });
}

export async function POST(request: Request): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:write");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }

  if (!hasJsonBody(request)) {
    return json(400, { error: "Send a JSON body with Content-Type: application/json" });
  }
  const body = await request.json().catch(function ignore() {
    return null;
  });
  const parsed = CreateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { error: "A webhook needs a url." });
  }

  try {
    const created = await createWebhookEndpoint(actor.userId, parsed.data);
    logEvent("watch", { event: "webhook_created", userId: actor.userId, webhookId: created.id });
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "webhook.create",
      resourceType: "webhook",
      resourceId: created.id,
    });
    // The plaintext secret is returned exactly once, here: the row stores it
    // encrypted and nothing ever decrypts it back to a caller.
    return json(201, { webhook: created });
  } catch (error) {
    if (error instanceof InvalidWebhookUrlError) {
      return json(400, { error: error.message });
    }
    if (error instanceof WebhookLimitError) {
      return json(429, { error: error.message });
    }
    throw error;
  }
}
