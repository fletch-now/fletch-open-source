// GET /api/v1/chains/:chainId/bridge — the token bridge: what each bridged
// asset's L1 escrow holds against its L2 supply (the gap is value in
// flight), the latest deposits and withdrawals seen on L2, and withdrawals
// whose challenge window has passed. `symbol` narrows the flows to one asset.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { parseLimit } from "@/lib/api/params";
import { RH_MAINNET_ID } from "@/lib/config";
import { getAssetBySymbol, listAssets } from "@/lib/registry/assets";
import { bridgeEscrowAll, bridgeFlowsFor, claimableWithdrawals, recentBridgeFlows } from "@/lib/registry/authority/bridge";
import { publicBridgeFlow, publicEscrow } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/bridge">): Promise<Response> {
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
  const symbol = params.get("symbol")?.toUpperCase();
  const limit = parseLimit(params.get("limit"), 100, 500);
  const all = await listAssets(chainId);
  const symbols = new Map(all.map((asset) => [asset.id, asset.symbol]));
  const asset = symbol ? await getAssetBySymbol(chainId, symbol) : null;
  if (symbol && !asset) {
    return publicJson(404, { error: "Asset not found" });
  }
  const [escrow, flows, claimable] = await Promise.all([bridgeEscrowAll(chainId), asset ? bridgeFlowsFor(asset.id, limit) : recentBridgeFlows(chainId, limit), claimableWithdrawals(chainId)]);
  const now = Date.now();
  return cachedJson(
    request,
    {
      escrow: escrow.map((row) => publicEscrow(row, symbols)),
      flows: flows.map((flow) => publicBridgeFlow(flow, symbols)),
      claimable: claimable.filter((flow) => flow.claimableAt && flow.claimableAt.getTime() <= now).map((flow) => publicBridgeFlow(flow, symbols)),
      note: "Whether a claimable withdrawal was executed on L1 is not recorded per flow; the escrow gap (inFlightRaw) carries the total still held.",
    },
    60,
  );
}
