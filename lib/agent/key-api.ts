import { keyMutationOriginAllowed } from "@/lib/agent/key-origin";
import { readBoundedJson } from "@/lib/request-body";
import { checkModelKeyRate } from "@/lib/ratelimit";

export async function guardKeyMutation(request: Request, userId: string): Promise<Response | null> {
  if (!keyMutationOriginAllowed(request)) {
    return Response.json({ error: "Use the signed-in Settings page to manage model keys." }, { status: 403 });
  }
  const rate = await checkModelKeyRate(userId);
  if (!rate.ok) return Response.json({ error: rate.reason }, { status: 429 });
  return null;
}
export async function readKeyBody(request: Request, limit = 4096): Promise<unknown> {
  return readBoundedJson(request, limit).catch(() => null);
}
