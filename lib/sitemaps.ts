import "server-only";
import { APP_URL } from "@/lib/config";
import { DOC_PAGES, docHref } from "@/lib/docs/content";

export const SITEMAP_PAGE_SIZE = 10_000;
export function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
export interface SitemapEntry { path: string; updatedAt?: Date; image?: string; }
export function urlset(entries: SitemapEntry[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${entries.map((entry) => `<url><loc>${xml(APP_URL + entry.path)}</loc>${entry.updatedAt ? `<lastmod>${entry.updatedAt.toISOString()}</lastmod>` : ""}${entry.image ? `<image:image><image:loc>${xml(APP_URL + entry.image)}</image:loc></image:image>` : ""}</url>`).join("")}</urlset>`;
}
export function sitemapIndex(appCount: number, tokenCount: number): string {
  const paths = ["/sitemap-site-0.xml"];
  for (const [kind, count] of [["apps", appCount], ["tokens", tokenCount]] as const) {
    for (let page = 0; page < Math.ceil(count / SITEMAP_PAGE_SIZE); page++) paths.push(`/sitemap-${kind}-${page}.xml`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<sitemap><loc>${xml(APP_URL + path)}</loc></sitemap>`).join("")}</sitemapindex>`;
}
export function siteEntries(): SitemapEntry[] {
  const paths = ["/", "/apps", "/published", "/registry", "/registry/markets", "/registry/changes", "/registry/lookalikes", "/registry/issuer", "/registry/status", "/developers", "/docs", "/docs/all", "/pricing", ...DOC_PAGES.map((page) => docHref(page.slug))];
  return [...new Set(paths)].map((path) => ({ path }));
}
export function sitemapResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache, max-age=0", "X-Content-Type-Options": "nosniff" } });
}
export function sitemapUnavailable(): Response {
  return new Response("The sitemap could not be read. Try again shortly.", { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } });
}
