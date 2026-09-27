import type { MetadataRoute } from "next";
import { APP_URL } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated and machine surfaces: nothing here is useful to a crawler,
      // and /api/dev exists only in development.
      disallow: ["/dashboard", "/trafalgar", "/admin", "/api/"],
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}
