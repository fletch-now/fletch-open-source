import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { deleteProject, ProjectDeletionError } from "@/lib/projects/delete";
import { logEvent } from "@/lib/log";

// Renaming an app. The name is what a person calls their own project; the slug
// is not touched, so the hosted address and every link to it stay put.
const MAX_NAME = 60;

export async function PATCH(request: Request, ctx: RouteContext<"/api/projects/[id]">): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await request.json().catch(function notJson() {
    return {};
  })) as { name?: unknown };
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length === 0) {
    return NextResponse.json({ error: "Give the app a name." }, { status: 400 });
  }
  if (name.length > MAX_NAME) {
    return NextResponse.json({ error: `Keep the name under ${MAX_NAME} characters.` }, { status: 400 });
  }
  const updated = await db
    .update(projects)
    .set({ name, nameSource: "user" })
    .where(and(eq(projects.id, id), eq(projects.userId, session.user.id)))
    .returning({ id: projects.id, name: projects.name });
  if (!updated[0]) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ project: updated[0] });
}

// Completed execution and credit records survive project deletion. The durable
// intent lets the same DELETE finish safely after a filesystem or connection error.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/projects/[id]">): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    const deleted = await deleteProject(session.user.id, id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(deleted);
  } catch (error) {
    if (error instanceof ProjectDeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
    logEvent("project", { event: "delete-incomplete", projectId: id, userId: session.user.id,
      message: error instanceof Error ? error.message : "Unknown deletion error" });
    return NextResponse.json({ error: "Could not confirm deletion. Retry Delete to check and finish it." }, { status: 500 });
  }
}
