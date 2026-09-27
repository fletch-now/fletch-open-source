import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { appCatalogPage, appCatalogQuery } from "@/lib/api/app-catalog";
import { RH_MAINNET_ID } from "@/lib/config";
import { readAppCatalog } from "@/lib/registry/app-catalog";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/app-catalog">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId: chain } = await ctx.params;
  const chainId = Number(chain);
  if (chainId !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  let query;
  try { query = appCatalogQuery(new URL(request.url).searchParams); }
  catch (error) { return publicJson(400, { error: error instanceof Error ? error.message : "Invalid catalog query" }); }
  const reading = await readAppCatalog();
  const page = appCatalogPage(reading, chainId, query);
  if (!reading.observedAt) return publicJson(503, { ...page, error: reading.error ?? "Robinhood app catalog has not been observed yet" });
  return cachedJson(request, { ...page }, 0, false);
}
