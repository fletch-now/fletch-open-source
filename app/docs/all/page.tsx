import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { DocsAiAccess } from "@/components/docs/ai-access";
import { ApiReference } from "@/components/docs/api-reference";
import { DocArticle, DocsVerification } from "@/components/docs/document";
import { DocsTitle } from "@/components/docs/prose";
import { DOC_PAGES, docHref } from "@/lib/docs/content";
import { canonical, pageMetadata } from "@/lib/seo";
import { connection } from "next/server";
import { DocsLiveNumbers } from "@/components/docs/live-numbers";

export const metadata: Metadata = {
  ...pageMetadata("/docs/all", "All documentation | Fletch docs", "Every Fletch guide and the generated API reference on one page, with a complete Markdown export for AI."),
  alternates: { canonical: canonical("/docs/all"), types: { "text/plain": canonical("/llms-full.txt") } },
};

export default async function AllDocumentationPage(): Promise<ReactElement> {
  await connection();
  return (
    <>
      <DocsTitle lede="Build an app, set up a watcher or use the API, with every guide and reference in reading order.">All documentation</DocsTitle>
      <nav aria-label="All documentation contents" className="mb-12">
        <ol className="list-decimal space-y-2 pl-5 text-[14px] text-ink-soft">
          {DOC_PAGES.map((page) => <li key={page.slug}><a href={`#${page.slug || "overview"}`} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-hood">{page.title}</a></li>)}
        </ol>
      </nav>
      <DocsAiAccess />
      <DocsVerification />
      {DOC_PAGES.map(function document(page) {
        return (
          <section key={page.slug} id={page.slug || "overview"} className="mb-14 scroll-mt-24 border-t border-line pt-10">
            <Link href={docHref(page.slug)} prefetch={false} className="mb-5 inline-block text-[12px] text-ink-soft underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-hood">Open {page.title}</Link>
            {page.slug === "api" ? <ApiReference embedded /> : <DocArticle page={page} embedded />}
            {page.slug === "registry-reading" ? <DocsLiveNumbers /> : null}
          </section>
        );
      })}
    </>
  );
}
