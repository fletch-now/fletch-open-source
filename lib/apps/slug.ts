export const LISTING_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(["api", "admin", "new", "edit", "sitemap", "opengraph-image"]);

export function validListingSlug(slug: string): boolean {
  return slug.length >= 3 && slug.length <= 60 && LISTING_SLUG.test(slug)
    && !slug.startsWith("forge-") && !RESERVED.has(slug);
}

export function suggestListingSlug(title: string): string {
  const slug = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 50).replace(/-$/, "");
  return validListingSlug(slug) ? slug : "my-app";
}
