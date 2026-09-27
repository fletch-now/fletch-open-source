import { notFound } from "next/navigation";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og";
import { findDoc } from "@/lib/docs/content";

export const alt = "Fletch product documentation";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Response> {
  const page = findDoc((await params).slug);
  if (!page) notFound();
  const titles: Record<string, string> = {
    "quickstart-watch": "Your first\ntoken alert.",
    "quickstart-build": "Your first\nhosted app.",
    "quickstart-api": "Your first\nAPI request.",
    build: "Build an app.\nRead the receipts.",
    markets: "Find the token.\nCheck the data.",
    agents: "Chain facts\nfor your agent.",
    why: "The evidence\nbehind the app.",
    limits: "Know the\ncurrent limits.",
    faq: "Fletch,\nexplained.",
    "truth-oracle": "On-Chain\nTruth Oracle.",
    compiler: "The compiler\nis the judge.",
    infrastructure: "Your app.\nHosting included.",
    persistence: "Close the tab.\nWork continues.",
    "registry-reading": "How Fletch\nreads the chain.",
    roadmap: "What shipped.\nWhat comes next.",
  };
  return brandCard({
    title: titles[page.slug] ?? page.title,
    subtitle: "Fletch documentation",
  });
}
