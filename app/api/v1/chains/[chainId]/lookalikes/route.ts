// GET /api/v1/chains/:chainId/lookalikes — every ERC-20 on the chain that
// borrows a listed ticker or exact name at a different address, with holder
// counts and observed beacon dependencies. Issuer origin requires separate
// listing or verified deployment evidence. `symbol` and `kind` filter rows;
// `offset` pages past `limit`, and a page shorter than `limit` is the last.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { lookalikesPage } from "@/lib/registry/authority/read";
import { publicLookalike } from "@/lib/registry/authority/shape";
import { lookalikeQuery } from "@/lib/api/lookalike-query";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/lookalikes">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  let query;
  try {
    query = lookalikeQuery(new URL(request.url).searchParams);
  } catch (error) {
    return publicJson(400, { error: error instanceof Error ? error.message : "Invalid lookalike query" });
  }
  const page = await lookalikesPage(chainId, query);
  const next = query.offset + page.rows.length;
  return cachedJson(request, { lookalikes: page.rows.map(publicLookalike), total: page.total,
    limit: query.limit, offset: query.offset, nextOffset: next < page.total ? next : null }, 0, false);
}
