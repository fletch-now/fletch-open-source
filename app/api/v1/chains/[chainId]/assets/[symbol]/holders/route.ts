// GET /api/v1/chains/:chainId/assets/:symbol/holders — who holds one asset,
// largest first, with each holder's share of supply, what the registry knows
// the address to be (a DEX pool, the issuer's wallet, a bridge gateway), and
// the latest concentration reading with the shares that say where the supply
// sits. `progress` says how far the ledger trails the chain; while it is still
// reading history the list is partial and says so.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseLimit, parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { labelsFor } from "@/lib/registry/authority/labels";
import { ledgerProgress } from "@/lib/registry/authority/ledger";
import { holderCount, latestConcentration, stateFor, topHolders } from "@/lib/registry/authority/read";
import { publicConcentration, publicHolder } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

const COMPLETE_WITHIN_BLOCKS = BigInt(10_000);

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]/holders">): Promise<Response> {
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
  const limit = parseLimit(new URL(request.url).searchParams.get("limit"), 50, 500);
  const [state, holders, count, concentration, progress] = await Promise.all([
    stateFor(asset.id),
    topHolders(asset.id, limit),
    holderCount(asset.id),
    latestConcentration(asset.id),
    ledgerProgress(chainId),
  ]);
  const labels = await labelsFor(holders.map((row) => row.holder));
  return cachedJson(
    request,
    {
      symbol: asset.symbol,
      decimals: asset.decimals,
      // The denominators, because the body carries two kinds of share:
      // `sharePct` is a balance over this live total supply, while the
      // concentration shares are over the balances the ledger held at
      // `asOfBlock`, and the two differ while the ledger trails the chain.
      totalSupplyRaw: state?.totalSupplyRaw ?? null,
      holders: holders.map((row) => publicHolder(row, state?.totalSupplyRaw ?? null, labels.get(row.holder) ?? null)),
      holderCount: count,
      concentration: publicConcentration(concentration),
      progress: {
        ledgerBlock: progress.block?.toString() ?? null,
        headBlock: progress.head?.toString() ?? null,
        complete: progress.behind !== null && progress.behind <= COMPLETE_WITHIN_BLOCKS,
      },
    },
    60,
  );
}
