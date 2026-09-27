import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { tokenMarketQuery, tokenMarketParams } from "@/lib/api/token-market-query";
import { RH_MAINNET_ID } from "@/lib/config";
import { readTokenMarkets } from "@/lib/registry/token-markets";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/markets">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId: chain } = await ctx.params;
  const chainId = Number(chain);
  if (chainId !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  let query;
  try {
    query = tokenMarketQuery(new URL(request.url).searchParams);
  } catch (error) {
    return publicJson(400, { error: error instanceof Error ? error.message : "Invalid market query" });
  }
  const page = await readTokenMarkets(chainId, query);
  return cachedJson(request, {
    ...page,
    chainId,
    appliedFilters: Object.fromEntries(tokenMarketParams(query)),
    filterDefinitionsUrl: `/api/v1/chains/${chainId}/markets/filters`,
    scope: "Tracked token markets and requested contract readings. Activity covers each token's selected pool. contractSearch includes matching recorded contracts beyond tracked markets.",
    note: "Every metric carries its source, observation time and unavailable reason. Volume uses the stated quote valuation method. Dominance is an economic selection; the trust verdict records identity evidence separately. V3 quote holdings and V4 bounded 1% price-move estimates remain separate measures.",
  }, 0, false);
}
