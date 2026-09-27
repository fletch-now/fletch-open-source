import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { readStockPairingPage, stockPairingQuery } from "@/lib/registry/stock-pairings";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: { params: Promise<{ chainId: string }> }): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId: chain } = await ctx.params;
  const chainId = Number(chain);
  if (chainId !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  let query;
  try {
    query = stockPairingQuery(new URL(request.url).searchParams);
  } catch (error) {
    return publicJson(400, { error: error instanceof Error ? error.message : "Invalid pairing query" });
  }
  try {
    return cachedJson(request, { ...await readStockPairingPage(chainId, query) }, 0, false);
  } catch {
    return publicJson(503, { error: "Stock pairings are temporarily unavailable. Retry this request." });
  }
}
