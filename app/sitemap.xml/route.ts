import { directorySitemapCount } from "@/lib/apps/directory";
import { tokenSitemapCount } from "@/lib/registry/seo";
import { sitemapIndex, sitemapResponse, sitemapUnavailable } from "@/lib/sitemaps";

export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  try {
    const [apps, tokens] = await Promise.all([directorySitemapCount(), tokenSitemapCount()]);
    return sitemapResponse(sitemapIndex(apps, tokens));
  } catch { return sitemapUnavailable(); }
}
