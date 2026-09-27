// GET /api/v1/chains/:chainId/control-plane — the issuer's registry contract
// as it stands (paused, implementation, blocked addresses) and its latest
// events. This is the surface nobody else publishes. `offset` pages the
// events back to the registry's first block; a page shorter than `limit` is the last.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { controlState, recentControlEvents } from "@/lib/registry/authority/read";
import { publicControlEvent, publicControlState } from "@/lib/registry/authority/shape";
import { parseLimit, parseOffset } from "@/lib/api/params";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/control-plane">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get("limit"), 50, 200);
  const offset = parseOffset(params.get("offset"));
  const [state, events] = await Promise.all([controlState(chainId), recentControlEvents(chainId, limit, offset)]);
  return cachedJson(request, { state: publicControlState(state), events: events.map(publicControlEvent) }, 10);
}
