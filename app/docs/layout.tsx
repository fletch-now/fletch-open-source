import type { ReactElement, ReactNode } from "react";
import { SiteFooter } from "@/components/landing/site-footer";
import { RegistryHeader } from "@/components/registry/registry-header";
import { DocsSidebar, type DocsSearchEntry } from "@/components/docs/sidebar";
import { DOC_PAGES, docHref } from "@/lib/docs/content";
import { openApiDocument } from "@/lib/api/openapi";

const entries: DocsSearchEntry[] = DOC_PAGES.map(function searchEntry(page) {
  return {
    href: docHref(page.slug),
    title: page.title,
    description: page.description,
    text: [
      page.title,
      page.description,
      JSON.stringify(page.sections),
      page.slug === "api" ? JSON.stringify(openApiDocument) : "",
    ]
      .join(" ")
      .toLowerCase(),
    supplemental: Boolean(page.supplemental),
  };
});

export default function DocsLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return (
    <div className="relative flex flex-1 flex-col">
      <RegistryHeader section="docs" />
      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pb-16 pt-8 sm:px-6 lg:flex-row lg:gap-12 lg:px-8">
        <aside className="lg:w-60 lg:shrink-0">
          <DocsSidebar entries={entries} />
        </aside>
        <main className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {children}
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
