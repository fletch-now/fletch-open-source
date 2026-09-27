import type { Metadata } from "next";
import type { ReactElement } from "react";
import { DocArticle } from "@/components/docs/document";
import { findDoc } from "@/lib/docs/content";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/docs/webhooks");

export default function WebhooksDocsPage(): ReactElement {
  return <DocArticle page={findDoc("webhooks")!} />;
}
