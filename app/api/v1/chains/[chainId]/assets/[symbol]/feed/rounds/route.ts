// GET /api/v1/chains/:chainId/assets/:symbol/feed/rounds — the Chainlink
// feed's round history for one asset, newest first. `since` (ISO) narrows to
// rounds updated after an instant; `limit` up to 2000. Answers are
// price × multiplier, as the feed reports them.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseLimit, parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { feedRoundsFor, stateFor } from "@/lib/registry/authority/read";
import { publicFeedRound } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

function parseInstant(value: string | null): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]/feed/rounds">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam, symbol } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Asset not found" });
  }
  const ticker = parseSymbolParam(symbol);
  const asset = ticker ? await getAssetBySymbol(chainId, ticker) : null;
  if (!asset) {
    return publicJson(404, { error: "Asset not found" });
  }
  const params = new URL(request.url).searchParams;
  const limit = parseLimit(params.get("limit"), 200, 2000);
  const [state, rounds] = await Promise.all([stateFor(asset.id), feedRoundsFor(asset.id, limit, parseInstant(params.get("since")))]);
  return cachedJson(
    request,
    {
      symbol: asset.symbol,
      feed: state?.feedAddress ?? null,
      rounds: rounds.map(publicFeedRound),
    },
    60,
  );
}
