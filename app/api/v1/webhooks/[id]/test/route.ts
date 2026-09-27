// POST /api/v1/webhooks/{id}/test — send a signed `ping` to the endpoint now
// and answer with what it said. Sent directly rather than through the outbox: a
// test is answered in the request, and a failing test should not be retried for
// hours afterwards.

import { checkUserRate } from "@/lib/ratelimit";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { sendWebhookPing, WebhookDisabledError, WebhookNotFoundError } from "@/lib/watch/webhooks";

export async function POST(request: Request, ctx: RouteContext<"/api/v1/webhooks/[id]/test">): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:write");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const rate = await checkUserRate(`webhook-test:${actor.userId}`);
  if (!rate.ok) {
    return errorJson({ status: 429, error: "Too many test deliveries; try again later.", retryAfterSeconds: rate.retryAfterSeconds });
  }
  const { id } = await ctx.params;

  try {
    const result = await sendWebhookPing(actor.userId, id);
    // 200 either way: the request succeeded, and the endpoint's own answer is
    // the body. A caller reads `ok`, not the HTTP status, to know what happened.
    return json(200, { ok: result.ok, status: result.status, error: result.error });
  } catch (error) {
    if (error instanceof WebhookNotFoundError) {
      return json(404, { error: error.message });
    }
    // A disabled endpoint receives nothing from the outbox either, so a test
    // that "worked" would be the one delivery it ever gets.
    if (error instanceof WebhookDisabledError) {
      return json(400, { error: error.message });
    }
    throw error;
  }
}
