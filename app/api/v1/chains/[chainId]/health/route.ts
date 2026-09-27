// GET /api/v1/chains/:chainId/health — the chain's latest vital signs from
// the L2 RPC, the rollup's Ethereum contracts and the status page.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { latestHealth } from "@/lib/registry/authority/read";
import { publicHealth } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/health">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  return cachedJson(request, { health: publicHealth(await latestHealth(chainId)) }, 30);
}
