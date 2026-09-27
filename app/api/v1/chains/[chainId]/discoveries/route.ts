import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { tokenDiscoveries } from "@/lib/registry/discoveries";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/discoveries">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId } = await ctx.params;
  if (Number(chainId) !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some((key) => key !== "limit") || params.getAll("limit").length > 1) return publicJson(400, { error: "Use limit once, from 1 to 50." });
  const limit = params.get("limit") ?? "20";
  if (!/^[1-9]\d?$/.test(limit) || Number(limit) > 50) return publicJson(400, { error: "Use limit once, from 1 to 50." });
  try {
    const result = await tokenDiscoveries(RH_MAINNET_ID);
    return cachedJson(request, { ...result, items: result.items.slice(0, Number(limit)) }, 15);
  } catch {
    return publicJson(503, { error: "Token discoveries are temporarily unavailable. Try again shortly." });
  }
}
