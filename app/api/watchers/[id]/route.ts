import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import {
  deleteWatcher,
  InvalidDeliveryError,
  updateWatcher,
  WatchLimitError,
  WatchNotFoundError,
} from "@/lib/watch/create";

// Mirrors app/api/v1/watchers/[id]/route.ts: webhookId re-points the watcher,
// null sends it back to Telegram.
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

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/watchers/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  const body = await request.json().catch(function ignore() {
    return null;
  });
  const parsed = PatchWatcherSchema.safeParse(body);
  if (!parsed.success || (parsed.data.enabled === undefined && parsed.data.webhookId === undefined)) {
    return NextResponse.json({ error: "Send enabled, webhookId, or both." }, { status: 400 });
  }

  try {
    const watcher = await updateWatcher(session.user.id, id, parsed.data);
    await recordAudit({
      userId: session.user.id,
      actorType: "user",
      action: auditAction(parsed.data),
      resourceType: "watcher",
      resourceId: id,
    });
    return NextResponse.json({ watcher });
  } catch (error) {
    if (error instanceof WatchNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof WatchLimitError) return NextResponse.json({ error: error.message }, { status: 429 });
    if (error instanceof InvalidDeliveryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/watchers/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    await deleteWatcher(session.user.id, id);
    await recordAudit({
      userId: session.user.id,
      actorType: "user",
      action: "watcher.delete",
      resourceType: "watcher",
      resourceId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WatchNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw error;
  }
}
