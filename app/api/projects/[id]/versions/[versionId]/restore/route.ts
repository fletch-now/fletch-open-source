import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { restoreProjectVersion, VersionError } from "@/lib/build/versions";
import { checkUserRate } from "@/lib/ratelimit";
import { logEvent } from "@/lib/log";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";
import { keyMutationOriginAllowed } from "@/lib/agent/key-origin";

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/versions/[versionId]/restore">): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  if (!keyMutationOriginAllowed(request)) return NextResponse.json({ error: "Restore from the app's own page." }, { status: 403 });
  const { id, versionId } = await ctx.params;
  const rate = await checkUserRate(`restore:${session.user.id}`);
  if (!rate.ok) return NextResponse.json({ error: rate.reason }, { status: 429 });
  let body: { requestId?: unknown; sourceHash?: unknown } | null;
  try { body = await readBoundedJson(request, 1024) as typeof body; }
  catch (error) {
    if (error instanceof RequestBodyTooLargeError) return NextResponse.json({ error: "Restore request is too large." }, { status: 413 });
    throw error;
  }
  if (typeof body?.requestId !== "string" || typeof body?.sourceHash !== "string") return NextResponse.json({ error: "Inspect this version before restoring it." }, { status: 400 });
  try {
    const project = await restoreProjectVersion(session.user.id, id, versionId, body.requestId, body.sourceHash);
    if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ project }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof VersionError) return NextResponse.json({ error: error.message }, { status: error.status });
    logEvent("project", { event: "restore-incomplete", projectId: id, userId: session.user.id,
      message: error instanceof Error ? error.message : "Unknown restore error" });
    return NextResponse.json({ error: "Could not confirm the copy. Retry Restore to check the same request. Your original app is unchanged." }, { status: 500 });
  }
}
