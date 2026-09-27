import { POOL_DEPTH_DESCRIPTION } from "@/lib/api/market-descriptions";
// GET /api/v1/chains/:chainId/dex — the DEX venues the registry reads, and
// what each one contributes: pools that trade a listed asset, how many carry a
// dollar price, how deep they are, the swaps and volume over the rollup window,
// and how many assets take their premium from a pool there. `discovery` says
// how far each venue's pool scan has read, so a venue with few pools can be
// told from one still being read, or from one never read at all. Per-asset
// pools are at /assets/{symbol}/pools.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { venueScans, venueTotals, type VenueScan } from "@/lib/registry/authority/dex";
import { venueTitle } from "@/lib/registry/authority/constants";
import { publicVenueScan, publicVenueTotals } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

const NOTE =
  POOL_DEPTH_DESCRIPTION + " Venue depth is summed over priced pools. A pool is recorded when one side is a listed asset and the other is a listed quote (USDG, WETH or another Stock Token). An asset's price and premium use its selected deepest pool in dollars. Uniswap liquidity is raw in-range L and is comparable only between pools of the same pair. `swaps24h` counts swap logs and `transactions24h` counts distinct transactions in (metricsAsOf - 24 hours, metricsAsOf], using each event block timestamp. Values are null until the entire window is indexed and when its end is more than 120 seconds old. `volumeUsd24h` requires historical per-swap USD valuations; a current pool price is never substituted. Zero means a completely scanned window with no matching activity. The Pons launchpad creates its pools on the Uniswap v3 factory, so they are counted as uniswap_v3.";

function noteFor(scans: VenueScan[]): string {
  const never = scans.filter((scan) => !scan.scanned);
  if (never.length === 0) {
    return NOTE;
  }
  return `${NOTE} ${never.map((scan) => venueTitle(scan.venue)).join(" and ")} pool discovery has not run yet, so that venue's row is a zero, not a count.`;
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/dex">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  const [totals, scans] = await Promise.all([venueTotals(chainId), venueScans(chainId)]);
  return cachedJson(
    request,
    {
      venues: totals.map(publicVenueTotals),
      discovery: scans.map(publicVenueScan),
      note: noteFor(scans),
    },
    300,
  );
}
