import { registryCardMetric } from "@/lib/og-metrics";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
import { PUBLIC_PAGES } from "@/lib/seo-pages";

export const dynamic = "force-dynamic";

const page = PUBLIC_PAGES["/"];
export const alt = `${page.title} · Fletch`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return brandCard({ title: page.headline, subtitle: page.subtitle, metric: await registryCardMetric() });
}
