import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { DocsSection, DocsTitle, Snippet } from "@/components/docs/prose";
import { DocsAiAccess } from "@/components/docs/ai-access";
import { DocsDiagram } from "@/components/docs/diagram";
import { DocsRoadmap } from "@/components/docs/roadmap";
import {
  DOCS_VERIFIED_AT,
  docHref,
  findDoc,
  type DocPage,
} from "@/lib/docs/content";

export function DocsVerification(): ReactElement {
  return (
    <p className="mb-8 text-[12px] text-ink-faint">
      Last verified against production:{" "}
      <time dateTime={DOCS_VERIFIED_AT}>{DOCS_VERIFIED_AT}</time>. See{" "}
      <Link href="/docs/limits" className="underline underline-offset-4">
        current limits and availability
      </Link>
      .
    </p>
  );
}

export function DocsNext({ slug }: { slug: string }): ReactElement | null {
  const page = findDoc(slug);
  if (!page) return null;
  return (
    <footer className="mt-12 border-t border-line pt-6">
      <p className="mb-2 text-[12px] text-ink-faint">Continue reading</p>
      <Link
        href={docHref(page.slug)}
        prefetch={false}
        className="text-[15px] font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-hood focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood"
      >
        {page.title} →
      </Link>
    </footer>
  );
}

export function DocArticle({ page, embedded = false }: { page: DocPage; embedded?: boolean }): ReactElement {
  return (
    <article>
      <DocsTitle lede={page.description} embedded={embedded}>{page.title}</DocsTitle>
      {!embedded ? <DocsAiAccess /> : null}
      {!embedded ? <DocsVerification /> : null}
      {page.slug === "roadmap" && !embedded ? <DocsRoadmap /> : <div>
      {page.sections.map(function section(section) {
        const isJobSchedule = page.slug === "registry-reading" && section.table?.headings.includes("Cadence");
        return (
          <DocsSection key={section.title} title={section.title} embedded={embedded}>
            {section.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {section.diagram ? <DocsDiagram id={section.diagram} /> : null}
            {section.steps ? (
              <ol className="list-decimal space-y-5 pl-5 marker:text-ink-faint">
                {section.steps.map((step) => (
                  <li key={step} className="pl-1">
                    {step}
                  </li>
                ))}
              </ol>
            ) : null}
            {section.bullets ? (
              <ul className="list-disc space-y-3 pl-5">
                {section.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            ) : null}
            {section.table ? (
              <div
                className={isJobSchedule ? "overflow-x-auto rounded-card border border-line focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood" : "overflow-x-auto"}
                role={isJobSchedule ? "region" : undefined}
                aria-label={isJobSchedule ? "Registry job schedule. Scroll horizontally to read all columns." : undefined}
                tabIndex={isJobSchedule ? 0 : undefined}
              >
                <table className={`w-full border-collapse text-left text-[13px] leading-6 ${isJobSchedule ? "min-w-[1080px] table-fixed" : ""}`}>
                  {isJobSchedule ? (
                    <colgroup>
                      <col className="w-44" />
                      <col className="w-56" />
                      <col className="w-80" />
                      <col className="w-24" />
                      <col className="w-64" />
                    </colgroup>
                  ) : null}
                  <thead>
                    <tr>
                      {section.table.headings.map((heading) => (
                        <th
                          key={heading}
                          scope="col"
                          className={`border-b border-line px-3 py-3 font-medium text-ink ${isJobSchedule ? "whitespace-nowrap bg-panel/60" : "first:pl-0"}`}
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.table.rows.map((row) => (
                      <tr
                        key={row[0]}
                        id={page.slug === "trust" ? row[0] : undefined}
                      >
                        {row.map((cell, index) => (
                          <td
                            key={index}
                            className={`border-b border-line px-3 py-3 align-top ${isJobSchedule ? "break-normal [overflow-wrap:normal] first:whitespace-nowrap [&:nth-child(4)]:whitespace-nowrap" : "first:pl-0"}`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {section.code ? <Snippet>{section.code}</Snippet> : null}
            {section.links ? (
              <ul className={page.slug === "roadmap" ? "space-y-5" : "flex flex-wrap gap-x-5 gap-y-2"}>
                {section.links.map((link) => (
                  <li key={`${link.href}:${link.label}`}>
                    <Link
                      href={link.href}
                      prefetch={false}
                      className="underline underline-offset-4 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-hood"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </DocsSection>
        );
      })}
      </div>}
      {!embedded ? <DocsNext slug={page.next} /> : null}
    </article>
  );
}
