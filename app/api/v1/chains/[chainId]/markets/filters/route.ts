import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { MARKET_FILTER_CONTRACT } from "@/lib/registry/market-filters";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/markets/filters">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId } = await ctx.params;
  if (Number(chainId) !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  return cachedJson(request, { chainId: RH_MAINNET_ID, ...MARKET_FILTER_CONTRACT }, 300, false);
}
