import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { getPublicApp } from "@/lib/apps/directory";
export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/apps/[slug]">,
): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const app = await getPublicApp((await context.params).slug);
  if (!app) {
    const response = publicJson(404, { error: "App not found." });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return cachedJson(request, { app }, 0, false);
}
