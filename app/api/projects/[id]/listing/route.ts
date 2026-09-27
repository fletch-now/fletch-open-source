import { getSession } from "@/lib/dal";
import { APP_URL } from "@/lib/config";
import { checkUserRate } from "@/lib/ratelimit";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";
import { ListingInput } from "@/lib/apps/validation";
import {
  ListingError,
  ownerListing,
  saveListing,
  unlistApp,
} from "@/lib/apps/directory";

const HEADERS = { "Cache-Control": "private, no-store" };

function reply(body: object, status = 200): Response {
  return Response.json(body, { status, headers: HEADERS });
}

export async function GET(
  _request: Request,
  context: RouteContext<"/api/projects/[id]/listing">,
): Promise<Response> {
  const session = await getSession();
  if (!session) return reply({ error: "Sign in" }, 401);
  const owner = await ownerListing(session.user.id, (await context.params).id);
  return owner ? reply(owner) : reply({ error: "Project not found." }, 404);
}

async function mutate(
  request: Request,
  projectId: string,
  unlist: boolean,
): Promise<Response> {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (
    (origin !== null && origin !== new URL(APP_URL).origin) ||
    (site !== null && site !== "same-origin" && site !== "none")
  ) {
    return reply({ error: "Manage listings from your Fletch dashboard." }, 403);
  }
  const session = await getSession();
  if (!session) return reply({ error: "Sign in" }, 401);
  try {
    if (unlist) await unlistApp(session.user.id, projectId);
    else {
      const rate = await checkUserRate(`listing:${session.user.id}`);
      if (!rate.ok)
        return Response.json(
          {
            error:
              "Listing changes reached their hourly limit. You can still unlist an app.",
          },
          {
            status: 429,
            headers: {
              ...HEADERS,
              "Retry-After": String(rate.retryAfterSeconds ?? 60),
            },
          },
        );
      const parsed = ListingInput.safeParse(
        await readBoundedJson(request, 16384),
      );
      if (!parsed.success)
        return reply(
          {
            error:
              parsed.error.issues[0]?.message ?? "Check the listing fields.",
          },
          400,
        );
      await saveListing(session.user.id, projectId, parsed.data);
    }
  } catch (cause) {
    if (cause instanceof ListingError)
      return reply({ error: cause.message }, cause.status);
    if (cause instanceof RequestBodyTooLargeError)
      return reply({ error: "The listing request is too large." }, 413);
    throw cause;
  }
  return reply((await ownerListing(session.user.id, projectId))!);
}

export async function PUT(
  request: Request,
  context: RouteContext<"/api/projects/[id]/listing">,
): Promise<Response> {
  return mutate(request, (await context.params).id, false);
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/projects/[id]/listing">,
): Promise<Response> {
  return mutate(request, (await context.params).id, true);
}
