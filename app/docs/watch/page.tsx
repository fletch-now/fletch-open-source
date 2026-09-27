import type { Metadata } from "next";
import type { ReactElement } from "react";
import { DocArticle } from "@/components/docs/document";
import { findDoc, docHref } from "@/lib/docs/content";
import { pageMetadata } from "@/lib/seo";

const page = findDoc("watch")!;
export const metadata: Metadata = pageMetadata(
  docHref(page.slug),
  `${page.title} | Fletch docs`,
  page.description,
);

export default function DocumentationPage(): ReactElement {
  return <DocArticle page={page} />;
}
