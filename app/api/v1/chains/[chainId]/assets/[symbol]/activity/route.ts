// GET /api/v1/chains/:chainId/assets/:symbol/activity — transfers as
// economics, one row per UTC day: count, volume, mints, burns, transfers
// settled against USDG in the same transaction, transfers outside US market
// hours. `days` up to 400.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseLimit, parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { ledgerProgress } from "@/lib/registry/authority/ledger";
import { activityFor } from "@/lib/registry/authority/read";
import { publicActivityDay } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

const COMPLETE_WITHIN_BLOCKS = BigInt(10_000);

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]/activity">): Promise<Response> {
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
  const days = parseLimit(new URL(request.url).searchParams.get("days"), 30, 400);
  const [rows, progress] = await Promise.all([activityFor(asset.id, days), ledgerProgress(chainId)]);
  return cachedJson(
    request,
    {
      symbol: asset.symbol,
      decimals: asset.decimals,
      days: rows.map(publicActivityDay),
      ledgerBlock: progress.block?.toString() ?? null,
      // The same block the holders route carries: partial while the ledger
      // is still reading history.
      progress: {
        ledgerBlock: progress.block?.toString() ?? null,
        headBlock: progress.head?.toString() ?? null,
        complete: progress.behind !== null && progress.behind <= COMPLETE_WITHIN_BLOCKS,
      },
    },
    60,
  );
}
