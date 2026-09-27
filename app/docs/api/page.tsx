import type { Metadata } from "next";
import type { ReactElement } from "react";
import { ApiReference } from "@/components/docs/api-reference";
import { publicPageMetadata } from "@/lib/seo";

export const metadata: Metadata = publicPageMetadata("/docs/api");

export default function ApiReferencePage(): ReactElement {
  return <ApiReference />;
}
