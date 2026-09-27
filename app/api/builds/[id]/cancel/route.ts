import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { cancelBuild } from "@/lib/build/runner";
import { ACTIVE_BUILD_STATUSES, cancelQueuedBuild } from "@/lib/build/queue";
import { readBoundedJson } from "@/lib/request-body";
import { recordAudit } from "@/lib/audit";

// Stop persists intent and interrupts the owned run. Cleanup retains its slot;
// the terminal failure refunds an actual debit after active work stops.
export async function POST(request: Request, ctx: RouteContext<"/api/builds/[id]/cancel">): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  let queuedOnly = false;
  if (request.body) {
    let body: unknown;
    try { body = await readBoundedJson(request, 1024, { allowEmpty: true }); }
    catch { return NextResponse.json({ error: "Invalid cancel request." }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).some((key) => key !== "queuedOnly")
      || ("queuedOnly" in body && typeof body.queuedOnly !== "boolean")) {
      return NextResponse.json({ error: "Expected an optional queuedOnly boolean." }, { status: 400 });
    }
    queuedOnly = "queuedOnly" in body && body.queuedOnly === true;
  }
  const { id } = await ctx.params;
  const rows = await db.select({ userId: builds.userId, status: builds.status }).from(builds).where(eq(builds.id, id)).limit(1);
  const build = rows[0];
  if (!build || build.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (queuedOnly) {
    const cancelled = await cancelQueuedBuild(id, session.user.id);
    if (!cancelled) return NextResponse.json({ error: "This build has already started or finished. It was not cancelled." }, { status: 409 });
    await recordAudit({ userId: session.user.id, actorType: "user", action: "build.cancel", resourceType: "build", resourceId: id });
    return NextResponse.json({ stopped: true, draft: cancelled.draft, refunded: cancelled.refunded });
  }
  if (build.status !== "queued" && build.status !== "paused" && !ACTIVE_BUILD_STATUSES.some((status) => status === build.status)) {
    return NextResponse.json({ error: "That build has already finished." }, { status: 409 });
  }
  const cancellation = await cancelBuild(id, session.user.id);
  if (cancellation) {
    await recordAudit({ userId: session.user.id, actorType: "user", action: "build.cancel", resourceType: "build", resourceId: id });
  }
  if (!cancellation) return NextResponse.json({ error: "That build has already finished." }, { status: 409 });
  return NextResponse.json({ accepted: true, stopped: !cancellation.stopping, stopping: cancellation.stopping }, { status: cancellation.stopping ? 202 : 200 });
}
