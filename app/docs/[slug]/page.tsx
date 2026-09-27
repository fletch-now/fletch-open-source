import type { Metadata } from "next";
import type { ReactElement } from "react";
import { notFound } from "next/navigation";
import { DocArticle } from "@/components/docs/document";
import { DOC_PAGES, docHref, findDoc } from "@/lib/docs/content";
import { pageMetadata } from "@/lib/seo";
import { connection } from "next/server";
import { DocsLiveNumbers } from "@/components/docs/live-numbers";

interface Props {
  params: Promise<{ slug: string }>;
}

const STATIC_ROUTES = new Set(["", "api", "watch", "trust", "webhooks", "mcp"]);

export function generateStaticParams(): { slug: string }[] {
  return DOC_PAGES.filter((page) => !STATIC_ROUTES.has(page.slug)).map(
    (page) => ({ slug: page.slug }),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = findDoc((await params).slug);
  if (!page) notFound();
  return pageMetadata(
    docHref(page.slug),
    `${page.title} | Fletch docs`,
    page.description,
  );
}

export default async function DocumentationPage({
  params,
}: Props): Promise<ReactElement> {
  const page = findDoc((await params).slug);
  if (!page) notFound();
  if (page.slug === "registry-reading") {
    await connection();
    return <><DocsLiveNumbers /><DocArticle page={page} /></>;
  }
  return <DocArticle page={page} />;
}
