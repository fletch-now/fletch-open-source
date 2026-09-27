import { join } from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { workspaceRoot } from "@/lib/build/workspace";
import { isSafeRelativePath, listWorkspaceArtifacts, readWorkspaceFile } from "@/lib/build/workspace-files";
import { publicReadCache } from "@/lib/public-cache";
import { checkWorkspaceReadRate } from "@/lib/ratelimit";
import type { BuildArtifact } from "@/lib/build/types";

// Every request checks ownership before using this bounded process-local cache.
const readArtifacts = publicReadCache<{ artifacts: BuildArtifact[]; observedAt: string }>(2000, 64);
const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

// The full text of one file in a project's workspace, for the build page's file
// viewer. Scoped to the owner, path-checked, never following a link.
export async function GET(request: NextRequest, ctx: RouteContext<"/api/projects/[id]/files">): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const path = request.nextUrl.searchParams.get("path");
  if (path !== null && !isSafeRelativePath(path)) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }
  const rows = await db
    .select({ slug: projects.slug })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .limit(1);
  const project = rows[0];
  if (!project) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const rate = await checkWorkspaceReadRate(session.user.id);
  if (!rate.ok) return NextResponse.json({ error: rate.reason }, {
    status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(rate.retryAfterSeconds ?? 60) },
  });
  if (path === null) {
    try {
      const snapshot = await readArtifacts(id, async function snapshot() {
        const artifacts = await listWorkspaceArtifacts(join(workspaceRoot(), project.slug), { entries: 4096, bytes: 8 * 1024 * 1024 });
        return { artifacts, observedAt: new Date().toISOString() };
      });
      return NextResponse.json(snapshot, { headers: PRIVATE_HEADERS });
    } catch {
      return NextResponse.json({ error: "File updates are unavailable. Your last file list is retained." }, { status: 503, headers: PRIVATE_HEADERS });
    }
  }
  const content = await readWorkspaceFile(join(workspaceRoot(), project.slug), path);
  if (content === null) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ path, content }, { headers: PRIVATE_HEADERS });
}
