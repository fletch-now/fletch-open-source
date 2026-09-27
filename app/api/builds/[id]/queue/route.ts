import { eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { readBuildQueue } from "@/lib/build/queue";

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const [build] = await db.select({ userId: builds.userId, status: builds.status }).from(builds).where(eq(builds.id, id)).limit(1);
  if (!build || build.userId !== session.user.id) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ status: build.status, queue: await readBuildQueue(id) }, { headers: { "Cache-Control": "no-store" } });
}
