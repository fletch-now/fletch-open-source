import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { logEvent } from "@/lib/log";
import { createWatcher, InvalidDeliveryError, InvalidTargetError, InvalidThresholdError, InvalidWalletError, UnreadableTokenError, WatchLimitError, WatchNotFoundError } from "@/lib/watch/create";
import { listWatchersForUser } from "@/lib/watch/queries";

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

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const watchers = await listWatchersForUser(session.user.id);
  return NextResponse.json({ watchers });
}

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }

  const body = await request.json().catch(function ignore() {
    return null;
  });
  const parsed = CreateWatcherSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid watcher" }, { status: 400 });
  }

  try {
    const watcher = await createWatcher(session.user.id, parsed.data);
    logEvent("watch", {
      event: "watcher_created",
      userId: session.user.id,
      watcherId: watcher.id,
      assetId: watcher.assetId,
      chainId: watcher.chainId,
    });
    await recordAudit({ userId: session.user.id, actorType: "user", action: "watcher.create", resourceType: "watcher", resourceId: watcher.id });
    return NextResponse.json({ watcher }, { status: 201 });
  } catch (error) {
    if (error instanceof InvalidThresholdError || error instanceof InvalidWalletError || error instanceof InvalidDeliveryError || error instanceof InvalidTargetError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // 422, not 400: the request was well formed and the chain did not answer.
    // Sending it again with watchAnyway is the documented next step.
    if (error instanceof UnreadableTokenError) {
      return NextResponse.json({ error: error.message, retryWith: "watchAnyway" }, { status: 422 });
    }
    if (error instanceof WatchNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof WatchLimitError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }
}
