import { POOL_DEPTH_DESCRIPTION } from "@/lib/api/market-descriptions";
// GET /api/v1/chains/:chainId/assets/:symbol/pools — the pools that trade one
// asset, deepest first, whichever DEX they are on: price in the quote and in
// dollars, liquidity, fee, hooks, and the last day's swaps and volume. `dex`
// on the asset's state names the pool used for the premium, and `discovery`
// says how far each venue's pool scan has read, so an empty list can be told
// from a scan that has not reached the pool yet.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol, listAssets } from "@/lib/registry/assets";
import { poolsFor, venueScans, type VenueScan } from "@/lib/registry/authority/dex";
import { venueTitle } from "@/lib/registry/authority/constants";
import { stateFor } from "@/lib/registry/authority/read";
import { publicPool, publicVenueScan } from "@/lib/registry/authority/shape";
import { trustForPools } from "@/lib/registry/trust";
import { stateReadIsCurrent } from "@/lib/registry/authority/dex-state-freshness";

export { preflight as OPTIONS } from "@/lib/api/etag";

const NOTE =
  POOL_DEPTH_DESCRIPTION + " Pools are deepest first by depthUsd. Uniswap liquidity is raw in-range L and is comparable only between pools of the same pair. `swaps24h` counts swap logs and `transactions24h` counts distinct transactions in (metricsAsOf - 24 hours, metricsAsOf], using each event block timestamp. Values are null until the entire window is indexed and when its end is more than 120 seconds old. `volumeUsd24h` requires historical per-swap USD valuations; a current pool price is never substituted. Zero means a completely scanned window with no matching activity.";

function noteFor(scans: VenueScan[]): string {
  const never = scans.filter((scan) => !scan.scanned);
  if (never.length === 0) {
    return NOTE;
  }
  return `${NOTE} ${never.map((scan) => venueTitle(scan.venue)).join(" and ")} pool discovery has not run yet, so no pool from there is listed.`;
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]/pools">): Promise<Response> {
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
  const [pools, all, state, scans] = await Promise.all([poolsFor(asset.id, 50), listAssets(chainId), stateFor(asset.id), venueScans(chainId)]);
  const symbols = new Map(all.map((entry) => [entry.id, entry.symbol]));
  const bestPool = pools.find((pool) => pool.id === state?.dexPoolId) ?? null;
  const identities = await trustForPools(chainId, pools, all);
  const current = state?.dexStateCurrent === true && bestPool?.stateObservationCurrent === true && stateReadIsCurrent(state.dexCheckedAt);
  return cachedJson(
    request,
    {
      symbol: asset.symbol,
      feedPriceUsd: state?.feedPrice ? Number(state.feedPrice) : null,
      best: state?.dexCheckedAt
        ? {
            poolId: state.dexPoolId,
            venue: state.dexVenue ?? bestPool?.venue ?? null,
            priceUsd: current && state.dexPriceUsd !== null ? Number(state.dexPriceUsd) : null,
            depthUsd: current && state.dexDepthUsd !== null ? Number(state.dexDepthUsd) : null,
            premiumPct: current && state.dexPremiumPct !== null ? Number(state.dexPremiumPct) : null,
            asOf: state.dexCheckedAt?.toISOString() ?? null,
            stateCurrent: current,
          }
        : null,
      pools: pools.map((pool) => publicPool(pool, symbols, undefined, 0, Date.now(), identities.get(pool.id))),
      discovery: scans.map(publicVenueScan),
      note: noteFor(scans),
    },
    0,
    false,
  );
}
