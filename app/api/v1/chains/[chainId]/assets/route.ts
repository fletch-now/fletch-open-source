// GET /api/v1/chains/:chainId/assets — the registry with each asset's live
// state. `q` searches symbol and name; `symbols=TSLA,AAPL` picks exact tickers;
// `fields=lookalikes,corporateActions,multiplierHistory,feedRounds,concentration`
// attaches the per-asset blocks the single-asset and holders routes serve, so an
// agent can read fifty tokens in one round trip instead of fifty.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { searchAssets, type RegistryAsset } from "@/lib/registry/assets";
import { browseAssets, browseAssetsPage, parseFilters } from "@/lib/registry/browse";
import { assetsQuery } from "@/lib/api/assets-query";
import { trustForTokens } from "@/lib/registry/trust";
import { corporateActionsFor, feedRoundsFor, latestConcentration, lookalikesFor, multiplierHistory, statesFor } from "@/lib/registry/authority/read";
import { publicConcentration, publicCorporateAction, publicFeedRound, publicLookalike, publicMultiplierEvent, publicState } from "@/lib/registry/authority/shape";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";

export { preflight as OPTIONS } from "@/lib/api/etag";

const KNOWN_CHAIN_IDS = new Set([RH_MAINNET_ID, RH_TESTNET_ID]);
const EXTRA_FIELDS = ["lookalikes", "corporateActions", "multiplierHistory", "feedRounds", "concentration"] as const;
type ExtraField = (typeof EXTRA_FIELDS)[number];
// Extra blocks are one query each per asset; past this many assets the caller
// should page by `symbols` rather than pull the whole registry with history.
const MAX_ASSETS_WITH_EXTRAS = 50;

function parseSymbols(value: string | null): Set<string> | null {
  if (!value) {
    return null;
  }
  const symbols = value
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  return symbols.length > 0 ? new Set(symbols.slice(0, 200)) : null;
}

function parseFields(value: string | null): ExtraField[] {
  if (!value) {
    return [];
  }
  return EXTRA_FIELDS.filter((field) => value.split(",").map((part) => part.trim()).includes(field));
}

async function extrasFor(asset: RegistryAsset, fields: ExtraField[]): Promise<Record<string, unknown>> {
  const blocks: Record<string, unknown> = {};
  if (fields.includes("lookalikes")) {
    blocks.lookalikes = (await lookalikesFor(asset.id)).map(publicLookalike);
  }
  if (fields.includes("corporateActions")) {
    blocks.corporateActions = (await corporateActionsFor(asset.symbol, 10)).map(publicCorporateAction);
  }
  if (fields.includes("multiplierHistory")) {
    blocks.multiplierHistory = (await multiplierHistory(asset.id, 20)).map(publicMultiplierEvent);
  }
  if (fields.includes("feedRounds")) {
    blocks.feedRounds = (await feedRoundsFor(asset.id, 30)).map(publicFeedRound);
  }
  if (fields.includes("concentration")) {
    blocks.concentration = publicConcentration(await latestConcentration(asset.id));
  }
  return blocks;
}

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/assets">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }

  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (!Number.isInteger(chainId) || !KNOWN_CHAIN_IDS.has(chainId)) {
    return publicJson(404, { error: "Unknown chain" });
  }

  const params = new URL(request.url).searchParams;
  const trustFilter = params.get("trust");
  if (trustFilter !== null && !["verified", "listed", "lookalike", "community", "unknown"].includes(trustFilter)) {
    return publicJson(400, { error: "Unknown trust level" });
  }
  let query: ReturnType<typeof assetsQuery>;
  try {
    query = assetsQuery(params);
  } catch (error) {
    return publicJson(400, { error: error instanceof Error ? error.message : "Invalid asset query" });
  }
  const symbols = parseSymbols(params.get("symbols"));
  const fields = parseFields(params.get("fields"));
  const selection = { symbols: symbols ? [...symbols] : undefined, trust: trustFilter ?? undefined };
  const filters = parseFilters(query.filters);
  let found: RegistryAsset[];
  let pagination: { total: number; limit: number; offset: number; nextOffset: number | null } | undefined;
  if (query.page) {
    const result = await browseAssetsPage(chainId, filters, query.page, selection);
    found = result.rows;
    const nextOffset = query.page.offset + result.rows.length;
    pagination = { total: result.total, ...query.page, nextOffset: nextOffset < result.total ? nextOffset : null };
  } else if (query.browse) {
    found = await browseAssets(chainId, filters, undefined, selection);
  } else {
    found = await searchAssets(chainId, params.get("q") ?? "");
  }
  const selected = symbols ? found.filter((asset) => symbols.has(asset.symbol.toUpperCase())) : found;
  const trust = await trustForTokens(chainId, selected.map((asset) => asset.address));
  const assets = trustFilter ? selected.filter((asset) => trust.get(asset.address.toLowerCase())?.level === trustFilter) : selected;
  if (fields.length > 0 && assets.length > MAX_ASSETS_WITH_EXTRAS) {
    return publicJson(400, { error: `fields= is limited to ${MAX_ASSETS_WITH_EXTRAS} assets per request; narrow with symbols=` });
  }
  const states = await statesFor(assets.map((asset) => asset.id));
  const rows = [];
  for (const asset of assets) {
    const listing = { ...asset } as RegistryAsset & { lookalikeCount?: number; floatPct?: string | null; unknownPct?: string | null };
    delete listing.lookalikeCount;
    delete listing.floatPct;
    delete listing.unknownPct;
    rows.push({ ...listing, trust: trust.get(asset.address.toLowerCase()), state: publicState(states.get(asset.id) ?? null), ...(await extrasFor(asset, fields)) });
  }
  return cachedJson(request, { assets: rows, fields: EXTRA_FIELDS, ...pagination }, 60);
}
