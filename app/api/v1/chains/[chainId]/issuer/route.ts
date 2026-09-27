// GET /api/v1/chains/:chainId/issuer — the issuer's paperwork as the legal
// hub lists it (base prospectus, supplements, notices, one Final Terms per
// ticker), each with its CDN ETag and Last-Modified and the token it maps
// to, plus the watched pages and when their text last changed.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { listAssets } from "@/lib/registry/assets";
import { issuerDocumentsAll, issuerPagesAll } from "@/lib/registry/authority/issuer";
import { publicIssuerDocument, publicIssuerPage } from "@/lib/registry/authority/shape";

export { preflight as OPTIONS } from "@/lib/api/etag";

export async function GET(request: Request, ctx: RouteContext<"/api/v1/chains/[chainId]/issuer">): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  const { chainId: chainIdParam } = await ctx.params;
  const chainId = Number(chainIdParam);
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  const kind = new URL(request.url).searchParams.get("kind");
  const [documents, pages, all] = await Promise.all([issuerDocumentsAll(), issuerPagesAll(), listAssets(chainId)]);
  const symbols = new Map(all.map((asset) => [asset.id, asset.symbol]));
  return cachedJson(
    request,
    {
      documents: documents.filter((doc) => !kind || doc.kind === kind).map((doc) => publicIssuerDocument(doc, symbols)),
      pages: pages.map(publicIssuerPage),
    },
    600,
  );
}
