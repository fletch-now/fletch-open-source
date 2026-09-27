import type { Metadata } from "next";
import { PUBLIC_PAGES, type PublicPagePath } from "@/lib/seo-pages";
import { APP_URL, RH_MAINNET_ID } from "@/lib/config";

// One place for the facts every page's markup repeats: who publishes the site,
// what it is, and the shapes search engines read. Pages pass their own words;
// nothing here is guessed per page.

export const SITE_NAME = "Fletch";
export const SITE_TAGLINE = "Build on Robinhood Chain. Fletch keeps it running.";
export const SITE_DESCRIPTION = PUBLIC_PAGES["/"].description;

export function canonical(path: string): string {
  return path === "/" ? APP_URL : `${APP_URL}${path}`;
}

export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: APP_URL,
    logo: `${APP_URL}/icon-512.png`,
    description: SITE_DESCRIPTION,
    sameAs: ["https://x.com/fletch_now", "https://t.me/fletch_now", "https://github.com/fletch-now"],
  };
}

export function websiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: APP_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@type": "Organization", name: SITE_NAME, url: APP_URL },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${APP_URL}/registry?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

// The product itself: a web application, free to start, on one chain.
export function applicationJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    url: APP_URL,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free build credits during the beta" },
  };
}

export function breadcrumbJsonLd(trail: Array<{ name: string; path: string }>): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(function step(item, index) {
      return { "@type": "ListItem", position: index + 1, name: item.name, item: canonical(item.path) };
    }),
  };
}

export function pageMetadata(path: string, title: string, description: string, index = true): Metadata {
  const image = { url: canonical(`${path === "/" ? "" : path}/opengraph-image`), width: 1200, height: 630, alt: `${title} · Fletch`, type: "image/png" };
  return {
    title,
    description,
    alternates: {
      canonical: canonical(path),
      ...(path === "/docs" || path.startsWith("/docs/") ? { types: { "text/plain": canonical("/llms-full.txt") } } : {}),
    },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: canonical(path), title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index, follow: true, googleBot: { index, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  };
}

export function publicPageMetadata(path: PublicPagePath): Metadata {
  const page = PUBLIC_PAGES[path];
  const metadata = pageMetadata(path, page.title, page.description);
  if (path === "/registry" || path === "/registry/changes") {
    metadata.alternates = { ...metadata.alternates, types: { "application/atom+xml": canonical("/registry/changes.xml"), "application/rss+xml": canonical("/registry/feed.xml") } };
  }
  if (path === "/registry/changes") {
    metadata.alternates = {
      ...metadata.alternates,
      types: { ...metadata.alternates?.types, "application/json": canonical(`/api/v1/chains/${RH_MAINNET_ID}/events`) },
    };
  }
  return metadata;
}
