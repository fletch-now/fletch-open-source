import { getSession } from "@/lib/dal";
import { APP_URL } from "@/lib/config";
import { checkUserRate } from "@/lib/ratelimit";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";
import { PublicationError, publicationStatus, requestPublication } from "@/lib/hosting/publications";

export async function GET(_request: Request, ctx: RouteContext<"/api/projects/[id]/publish">): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const status = await publicationStatus(session.user.id, id);
  if (!status) return Response.json({ error: "Project not found." }, { status: 404 });
  return Response.json(status, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, ctx: RouteContext<"/api/projects/[id]/publish">): Promise<Response> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin !== null && origin !== new URL(APP_URL).origin || site !== null && site !== "same-origin" && site !== "none") {
    return Response.json({ error: "Publish from your Fletch dashboard." }, { status: 403 });
  }
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in" }, { status: 401 });
  const { id } = await ctx.params;
  const rate = await checkUserRate(`publish:${session.user.id}`);
  if (!rate.ok) return Response.json({ error: "Publishing reached its request limit. Try later." }, {
    status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) },
  });
  let body: unknown;
  try { body = await readBoundedJson(request, 1024); }
  catch (cause) {
    if (!(cause instanceof RequestBodyTooLargeError)) throw cause;
    return Response.json({ error: "Publication request is too large." }, { status: 413 });
  }
  const buildId = body && typeof body === "object" && "buildId" in body ? body.buildId : null;
  if (typeof buildId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(buildId)) {
    return Response.json({ error: "Choose a completed preview to publish." }, { status: 400 });
  }
  try { await requestPublication(session.user.id, id, buildId); }
  catch (cause) {
    if (cause instanceof PublicationError) return Response.json({ error: cause.message }, { status: cause.status });
    throw cause;
  }
  return Response.json(await publicationStatus(session.user.id, id), { status: 202, headers: { "Cache-Control": "no-store" } });
}
