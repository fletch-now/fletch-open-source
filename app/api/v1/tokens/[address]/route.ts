import { POOL_DEPTH_DESCRIPTION } from "@/lib/api/market-descriptions";
// Identity and current market observations use the same read model as token pages.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { db } from "@/lib/db";
import { dexPools } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { Metric } from "@/lib/registry/token-markets-types";
import { readTokenMarket } from "@/lib/registry/token-markets";
import { revalidateTokenMarket } from "@/lib/registry/token-market-freshness";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { trustForToken } from "@/lib/registry/trust";
import { enqueueMarketSearch } from "@/lib/registry/authority/market-refresh";
import { clientIp } from "@/lib/ratelimit";

export { preflight as OPTIONS } from "@/lib/api/etag";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const NOTE =
  "Identity uses the canonical token trust check. A lookalike is a normalized name or ticker collision; `impersonates` identifies the matched listed contract. `reading` is the same observation shown on the token page, including source, age and an explanation for each unavailable metric. Community dominance describes the recorded economic comparison and never establishes issuer verification. Volume covers the selected pool only; its source states the quote-valuation method. " + POOL_DEPTH_DESCRIPTION;

export async function GET(request: Request, ctx: RouteContext<"/api/v1/tokens/[address]">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { address } = await ctx.params;
  if (!ADDRESS.test(address)) {
    return publicJson(400, { error: "Give a 20-byte hex address, 0x-prefixed." });
  }
  const chainId = RH_MAINNET_ID;
  const lower = address.toLowerCase();
  await enqueueMarketSearch(chainId, lower, clientIp(request.headers));
  const trustRead = trustForToken(chainId, lower);
  const [trust, observed] = await Promise.all([trustRead, readTokenMarket(chainId, lower, trustRead)]);
  const [pool] = observed?.bestPoolId ? await db.select({ id: dexPools.id, venue: dexPools.venue }).from(dexPools)
    .where(and(eq(dexPools.chainId, chainId), eq(dexPools.id, observed.bestPoolId))).limit(1) : [];
  const reading = observed ? revalidateTokenMarket(observed) : null;
  let depth: Metric<number> | null = null;
  if (pool && reading) {
    const candidate = pool.venue === "uniswap_v3" ? reading.v3QuoteHoldingsUsd : reading.v4OnePercentDepthUsd;
    if (candidate.observation.parameters.poolId === pool.id) depth = candidate;
  }
  return cachedJson(
    request,
    {
      chainId,
      address: lower,
      trust: trust.level,
      label: trust.label,
      detail: trust.detail,
      impersonates: trust.impersonates
        ? {
            symbol: trust.impersonates.symbol,
            name: trust.impersonates.name,
            address: trust.impersonates.address,
            registryUrl: `${APP_URL}/registry/${encodeURIComponent(trust.impersonates.symbol)}`,
          }
        : null,
      symbol: trust.symbol,
      name: trust.name,
      decimals: trust.decimals,
      source: trust.source,
      firstSeenAt: trust.firstSeenAt ? trust.firstSeenAt.toISOString() : null,
      readAt: trust.readAt ? trust.readAt.toISOString() : null,
      registryUrl: trust.source === "registry" && trust.symbol ? `${APP_URL}/registry/${encodeURIComponent(trust.symbol)}` : null,
      explorerUrl: explorerAddressUrl(chainId, lower),
      reading,
      market: pool && reading
        ? {
            poolId: pool.id,
            venue: pool.venue,
            priceUsd: reading.priceUsd.value,
            depthUsd: depth?.value ?? null,
            depthAsOf: depth?.asOf ?? null,
            depthReason: depth ? depth.reason : "No matching selected-pool depth observation is available.",
            depthMeasure: pool.venue === "uniswap_v3" ? "quote_holdings" : "bounded_one_percent_quote",
            swaps24h: reading.swaps24h.value,
            transactions24h: reading.transactions24h.value,
            metricsAsOf: reading.volumeUsd24h.asOf,
            priceSource: "dex" as const,
            volumeUsd24h: reading.volumeUsd24h.value,
          }
        : null,
      note: NOTE,
    },
    0,
    false,
  );
}
