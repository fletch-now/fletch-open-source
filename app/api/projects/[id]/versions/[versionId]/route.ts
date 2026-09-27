import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { getProjectVersion, getProjectVersionFile, VersionError } from "@/lib/build/versions";

export async function GET(request: Request, ctx: RouteContext<"/api/projects/[id]/versions/[versionId]">): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id, versionId } = await ctx.params;
  const path = new URL(request.url).searchParams.get("path");
  try {
    const value = path === null
      ? await getProjectVersion(session.user.id, id, versionId)
      : await getProjectVersionFile(session.user.id, id, versionId, path);
    if (value === null) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const body = path === null ? { version: value } : { path, content: value };
    return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof VersionError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
