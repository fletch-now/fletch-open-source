import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied } from "@/lib/api/etag";
import { listPublicApps } from "@/lib/apps/directory";
import { directoryQuery } from "@/lib/apps/validation";
import { APP_URL } from "@/lib/config";
export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { q, page } = directoryQuery(new URL(request.url).searchParams);
  const result = await listPublicApps(q, page);
  const next = new URL("/api/v1/apps", APP_URL);
  next.searchParams.set("page", String(page + 1));
  if (q) next.searchParams.set("q", q);
  return cachedJson(
    request,
    { ...result, next: result.hasMore ? next.toString() : null },
    0,
    false,
  );
}
