// GET/POST /api/v1/watchers — list and create, key- or session-authenticated.
// No watcher business logic lives here: lib/watch/create.ts and
// lib/watch/queries.ts own it, same as the dashboard's app/api/watchers/route.ts.

import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticateV1, errorJson, isV1Error, json } from "@/lib/auth/v1";
import { hasJsonBody } from "@/lib/api/params";
import { recordAudit } from "@/lib/audit";
import { logEvent } from "@/lib/log";
import { createWatcher, InvalidDeliveryError, InvalidTargetError, InvalidThresholdError, InvalidWalletError, UnreadableTokenError, WatchLimitError, WatchNotFoundError } from "@/lib/watch/create";
import { getWatcherForUser, listWatchersForUser } from "@/lib/watch/queries";

const CreateWatcherSchema = z.object({
  assetId: z.string().trim().min(1).max(120).optional(),
  // Any contract on the chain, instead of a registry asset id.
  address: z.string().trim().min(1).max(64).optional(),
  watchAnyway: z.boolean().optional(),
  threshold: z.string().trim().min(1).max(50).optional(),
  kind: z.enum(["large_transfer", "wallet_activity", "registry_event", "listing_event", "token_event", "new_pool"]).optional(),
  // new_pool only: hear about a launch only when its token borrows a listed ticker.
  lookalikesOnly: z.boolean().optional(),
  wallet: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().trim().min(1).max(64).optional(),
  // Deliver this watcher to a registered webhook endpoint instead of Telegram.
  webhookId: z.string().trim().min(1).max(64).optional(),
});

// "wt_" + sha256(userId + key) truncated to 32 hex chars: deterministic per
// (account, key), so retried POSTs with the same header land on the same id
// instead of minting a second watcher. No separate idempotency store — the
// watcher row itself is the record of "already done".
function idempotentWatcherId(userId: string, key: string): string {
  return `wt_${createHash("sha256").update(userId + key).digest("hex").slice(0, 32)}`;
}

export async function GET(request: Request): Promise<Response> {
  const actor = await authenticateV1(request, "watchers:read");
  if (isV1Error(actor)) {
    return errorJson(actor);
  }
  const watchers = await listWatchersForUser(actor.userId);
  return json(200, { watchers });
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
  const parsed = CreateWatcherSchema.safeParse(body);
  if (!parsed.success) {
    return json(400, { error: "Invalid watcher" });
  }

  const idempotencyKey = request.headers.get("Idempotency-Key");
  const watcherId = idempotencyKey ? idempotentWatcherId(actor.userId, idempotencyKey) : undefined;

  if (watcherId) {
    const existing = await getWatcherForUser(actor.userId, watcherId);
    if (existing) {
      return json(200, { watcher: existing });
    }
  }

  try {
    const created = await createWatcher(actor.userId, { ...parsed.data, id: watcherId });
    logEvent("watch", {
      event: "watcher_created",
      userId: actor.userId,
      watcherId: created.id,
      assetId: created.assetId,
      chainId: created.chainId,
      via: "v1",
    });
    await recordAudit({
      userId: actor.userId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "watcher.create",
      resourceType: "watcher",
      resourceId: created.id,
    });
    // Re-fetched so the response shape matches every other v1 watcher payload
    // (GET list/detail), rather than CreatedWatcher's narrower fields.
    const watcher = await getWatcherForUser(actor.userId, created.id);
    return json(201, { watcher });
  } catch (error) {
    if (error instanceof InvalidThresholdError || error instanceof InvalidWalletError || error instanceof InvalidDeliveryError || error instanceof InvalidTargetError) {
      return json(400, { error: error.message });
    }
    if (error instanceof UnreadableTokenError) {
      return json(422, { error: error.message, retryWith: "watchAnyway" });
    }
    if (error instanceof WatchNotFoundError) {
      return json(404, { error: error.message });
    }
    if (error instanceof WatchLimitError) {
      return json(429, { error: error.message });
    }
    throw error;
  }
}
