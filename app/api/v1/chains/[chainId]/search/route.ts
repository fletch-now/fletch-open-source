import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { searchTokenContracts } from "@/lib/registry/contract-search";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/search">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) return publicDenied(denied);
  const { chainId } = await ctx.params;
  if (Number(chainId) !== RH_MAINNET_ID) return publicJson(404, { error: "Unknown chain" });
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!["q", "page", "limit"].includes(key) || params.getAll(key).length !== 1) return publicJson(400, { error: "Use q, page and limit once each." });
  }
  const q = params.get("q") ?? "";
  const page = params.get("page") ?? "1";
  const limit = params.get("limit") ?? "10";
  if (q.length > 2048 || !/^[1-9]\d{0,4}$/.test(page) || !["10", "20", "50"].includes(limit)) return publicJson(400, { error: "Use a query up to 128 characters, a positive page, and limit 10, 20 or 50." });
  try {
    const result = await searchTokenContracts(RH_MAINNET_ID, q, Number(page), Number(limit));
    return cachedJson(request, { ...result, chainId: RH_MAINNET_ID, scope: "Recorded asset listings, contract metadata, lookalike observations and explorer candidates. Search matches are not identity verification." }, 15);
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid contract search query or page.") return publicJson(400, { error: error.message });
    return publicJson(503, { error: "Contract search is temporarily unavailable. Try again shortly." });
  }
}
