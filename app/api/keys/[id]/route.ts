import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { ApiKeyNotFoundError, revokeApiKey } from "@/lib/auth/api-keys";

export async function DELETE(
  _request: NextRequest,
  ctx: RouteContext<"/api/keys/[id]">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    await revokeApiKey(session.user.id, id);
  } catch (error) {
    if (error instanceof ApiKeyNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    throw error;
  }

  await recordAudit({
    userId: session.user.id,
    actorType: "user",
    action: "api_key.revoke",
    resourceType: "api_key",
    resourceId: id,
  });

  return NextResponse.json({ ok: true });
}
