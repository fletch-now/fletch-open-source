// GET /api/v1/chains/:chainId/status — whether the registry is live: the
// daemon's heartbeat, every job against its cadence, the scanners still
// reading history, and the newest timestamp behind each public figure.

import { statusResponse } from "@/lib/api/status";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/status">): Promise<Response> {
  const { chainId } = await ctx.params;
  return statusResponse(request, Number(chainId));
}
