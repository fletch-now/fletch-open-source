import { checkBuildContinueRate } from "@/lib/ratelimit";
import { getSession } from "@/lib/dal";
import { pool } from "@/lib/db";
import { continueOwnedBuild } from "@/lib/build/durable/continue";

export async function POST(_request: Request, ctx: RouteContext<"/api/builds/[id]/continue">): Promise<Response> {
  const origin = _request.headers.get("origin");
  if (origin && origin !== new URL(process.env.BETTER_AUTH_URL ?? _request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const rate = await checkBuildContinueRate(session.user.id);
  if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429, headers: { "retry-after": String(rate.retryAfterSeconds ?? 60) } });
  const { id } = await ctx.params;
  const { status, ...reading } = await continueOwnedBuild(pool, id, session.user.id);
  return Response.json(reading, { status });
}
