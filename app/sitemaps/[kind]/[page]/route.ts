import { directorySitemap } from "@/lib/apps/directory";
import { tokenSitemapPage } from "@/lib/registry/seo";
import { SITEMAP_PAGE_SIZE, siteEntries, sitemapResponse, sitemapUnavailable, urlset } from "@/lib/sitemaps";
import { listAssets } from "@/lib/registry/assets";
import { RH_MAINNET_ID } from "@/lib/config";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: RouteContext<"/sitemaps/[kind]/[page]">): Promise<Response> {
  const { kind, page: raw } = await context.params;
  if (!/^(0|[1-9]\d{0,3})\.xml$/.test(raw) || !["site", "apps", "tokens"].includes(kind)) return new Response("Sitemap not found.", { status: 404 });
  const page = Number(raw.slice(0, -4));
  try {
    if (kind === "site") {
      if (page !== 0) return new Response("Sitemap not found.", { status: 404 });
      const assets = await listAssets(RH_MAINNET_ID);
      return sitemapResponse(urlset([...siteEntries(), ...assets.map((asset) => ({ path: `/registry/${encodeURIComponent(asset.symbol)}` }))]));
    }
    const entries = kind === "apps"
      ? (await directorySitemap(undefined, page, SITEMAP_PAGE_SIZE)).map((app) => ({ path: `/published/${app.slug}`, updatedAt: app.updatedAt, image: `/published/${app.slug}/opengraph-image` }))
      : (await tokenSitemapPage(page, SITEMAP_PAGE_SIZE)).map((address) => ({ path: `/registry/markets/${address}` }));
    if (!entries.length) return new Response("Sitemap not found.", { status: 404 });
    return sitemapResponse(urlset(entries));
  } catch { return sitemapUnavailable(); }
}
