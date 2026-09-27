import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { listProjectVersions } from "@/lib/build/versions";

export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/versions">): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const versions = await listProjectVersions(session.user.id, id);
  if (!versions) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ versions }, { headers: { "Cache-Control": "private, no-store" } });
}
