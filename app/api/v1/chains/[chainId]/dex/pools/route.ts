// GET /api/v1/chains/:chainId/dex/pools — every pool on every DEX the registry
// reads, listed and community alike, one page at a time: the pair, the
// priced side (a listed asset or an unlisted token as its own contract
// describes it), price in quote and dollars, depth, the last day's swaps and
// volume, and FDV for a community token. This is the market table a
// DexScreener-style page reads from, and it never fabricates a figure: a
// pool the state read has not priced carries nulls.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { enqueueMarketSearch } from "@/lib/registry/authority/market-refresh";
import { clientIp } from "@/lib/ratelimit";
import { RH_MAINNET_ID } from "@/lib/config";
import { parseLimit, parseOffset } from "@/lib/api/params";
import { listAssets } from "@/lib/registry/assets";
import { discoveryFloorUsd, priceFloorUsd } from "@/lib/admin/settings";
import { dexPoolsPage, poolChanges, venueScans, type PoolKind, type PoolSort, type PoolTierFilter } from "@/lib/registry/authority/dex";
import { VENUE_V3, VENUE_V4 } from "@/lib/registry/authority/constants";
import { publicPool, publicVenueScan } from "@/lib/registry/authority/shape";
import { trustForPools } from "@/lib/registry/trust";

export { preflight as OPTIONS } from "@/lib/api/etag";

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;
const KINDS: PoolKind[] = ["all", "listed", "community", "lookalike"];
const SORTS: PoolSort[] = ["traction", "depth", "volume", "swaps", "newest"];
const TIERS: PoolTierFilter[] = ["active", "quiet", "dormant", "all"];
const VENUES = [VENUE_V4, VENUE_V3];

const NOTE =
  "Each pool's `trust` and compatibility alias `kind` use the same token verdict as /api/v1/tokens/{address}. `listing` separately records membership in Robinhood's asset list. A lookalike verdict records a matching name or symbol at a different address. " +
  "`sort=volume` orders measured 24-hour volume, with unavailable values last and a stable pool-ID tie-break. `traction` is the separate relevance order. `depthMeasure` distinguishes v3 quote-token holdings from the v4 bounded estimate for a 1% price move. These measures have different meanings and must not be added as TVL. " +
  "Prices and depth require a state observation within three minutes. Rolling swap metrics require complete coverage of the stated window and a current index head. The response gives observation times and coverage flags. An unavailable reading stays null; measured zero requires a complete window. Quote valuation is identified by its method and source. " +
  "`tier=all` includes archived rows. Other tiers apply the operator's listing floor and hidden-token flag; an explicit token address or pool ID remains searchable. Prices below the configured price floor are withheld. Price changes compare recorded samples and stay null when the required earlier sample is missing.";

function pick<T extends string>(value: string | null, allowed: T[], fallback: T): T {
  return value !== null && (allowed as string[]).includes(value) ? (value as T) : fallback;
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/dex/pools">): Promise<Response> {
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
  const query = {
    chainId,
    limit: parseLimit(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT),
    offset: parseOffset(params.get("offset")),
    kind: pick(params.get("kind") ?? params.get("trust"), KINDS, "all"),
    tier: pick(params.get("tier"), TIERS, "active"),
    sort: pick(params.get("sort"), SORTS, "volume"),
    venue: params.get("venue") !== null && VENUES.includes(params.get("venue") as string) ? params.get("venue") : null,
    q: (params.get("q") ?? "").trim().replace(/^\$/, "") || null,
    floorUsd: await discoveryFloorUsd(),
  };
  if (query.q) await enqueueMarketSearch(chainId, query.q, clientIp(request.headers));
  const all = await listAssets(chainId);
  const symbols = new Map(all.map((entry) => [entry.id, entry.symbol]));
  async function listedIdsFor(ticker: string): Promise<string[]> {
    return all.filter((entry) => entry.symbol.toUpperCase() === ticker).map((entry) => entry.id);
  }
  const [page, scans, priceFloor] = await Promise.all([dexPoolsPage(query, listedIdsFor), venueScans(chainId), priceFloorUsd()]);
  const [changes, identities] = await Promise.all([
    poolChanges(page.pools),
    trustForPools(chainId, page.pools, all),
  ]);
  return cachedJson(
    request,
    {
      pools: page.pools.map(function shape(pool) {
        const empty = { change5mPct: null, change1hPct: null, change6hPct: null, change24hPct: null };
        const row = publicPool(pool, symbols, page.tokens, priceFloor, Date.now(), identities.get(pool.id));
        return { ...row, ...(row.pricePublished ? (changes.get(pool.id) ?? empty) : empty) };
      }),
      total: page.total,
      limit: query.limit,
      offset: query.offset,
      kind: query.kind,
      tier: query.tier,
      sort: query.sort,
      venue: query.venue,
      q: query.q,
      discovery: scans.map(publicVenueScan),
      note: NOTE,
    },
    0,
    false,
  );
}
