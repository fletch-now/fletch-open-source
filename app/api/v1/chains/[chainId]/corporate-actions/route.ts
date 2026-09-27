// GET /api/v1/chains/:chainId/corporate-actions — actions in progress, as
// Robinhood publishes them, each tied to the token it affects.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { upcomingCorporateActions } from "@/lib/registry/authority/read";
import { publicCorporateAction } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/corporate-actions">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  if (Number(chainIdParam) !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  const actions = await upcomingCorporateActions(100);
  return cachedJson(request, { actions: actions.map(publicCorporateAction) }, 3600);
}
