// GET /api/v1/chains/:chainId/assets/:symbol — one registry asset by symbol
// (e.g. AAPL), for a caller that already knows what it wants rather than
// searching. 404s the same way for "no such chain" and "no such symbol" — v1
// callers shouldn't be able to distinguish an unsupported chain from a typo.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { parseSymbolParam } from "@/lib/api/params";
import { getAssetBySymbol } from "@/lib/registry/assets";
import { trustForToken } from "@/lib/registry/trust";
import { controlEventsForAccount, corporateActionsFor, feedRoundsFor, lookalikesFor, multiplierHistory, stateFor, supplyHistory, supplySnapshots } from "@/lib/registry/authority/read";
import { publicControlEvent, publicCorporateAction, publicFeedRound, publicLookalike, publicMultiplierEvent, publicState, publicSupplyEvent, publicSupplySnapshot } from "@/lib/registry/authority/shape";
import { RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";

export { preflight as OPTIONS } from "@/lib/api/etag";

const KNOWN_CHAIN_IDS = new Set([RH_MAINNET_ID, RH_TESTNET_ID]);

export async function GET(
  request: Request,
  ctx: RouteContext<"/api/v1/chains/[chainId]/assets/[symbol]">,
): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }

  const { chainId: chainIdParam, symbol } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (!Number.isInteger(chainId) || !KNOWN_CHAIN_IDS.has(chainId)) {
    return publicJson(404, { error: "Asset not found" });
  }

  const ticker = parseSymbolParam(symbol);
  const asset = ticker ? await getAssetBySymbol(chainId, ticker) : null;
  if (!asset) {
    return publicJson(404, { error: "Asset not found" });
  }
  // `trust` is derived, not stored: an agent should not have to reimplement the
  // rule that a row counts as confirmed only when the contract agrees with the
  // listing. The fields it is derived from are on the asset either way.
  const [state, multipliers, supply, snapshots, actions, control, lookalikeRows, rounds, trust] = await Promise.all([
    stateFor(asset.id),
    multiplierHistory(asset.id, 20),
    supplyHistory(asset.id, 20),
    supplySnapshots(asset.id, 14),
    corporateActionsFor(asset.symbol, 10),
    controlEventsForAccount(asset.address, 10),
    lookalikesFor(asset.id),
    feedRoundsFor(asset.id, 30),
    trustForToken(chainId, asset.address),
  ]);
  return cachedJson(request, {
    asset,
    trust,
    state: publicState(state),
    multiplierHistory: multipliers.map(publicMultiplierEvent),
    supplyEvents: supply.map(publicSupplyEvent),
    supplySnapshots: snapshots.map(publicSupplySnapshot),
    corporateActions: actions.map(publicCorporateAction),
    controlEvents: control.map(publicControlEvent),
    lookalikes: lookalikeRows.map(publicLookalike),
    feedRounds: rounds.map(publicFeedRound),
  }, 60);
}
