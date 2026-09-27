import type { Metadata } from "next";
import type { ReactElement } from "react";
import { DocArticle } from "@/components/docs/document";
import { findDoc } from "@/lib/docs/content";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/docs/mcp");

export default function McpDocsPage(): ReactElement {
  return <DocArticle page={findDoc("mcp")!} />;
}
