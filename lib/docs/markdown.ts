import { DOC_PAGES, DOCS_VERIFIED_AT, docHref, type DocPage, type DocSection } from "@/lib/docs/content";
import { diagramText } from "@/lib/docs/diagrams";

const ORIGIN = "https://fletch.now";

function link(href: string, label: string): string {
  return `[${label}](${new URL(href, ORIGIN).href})`;
}

function tableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function sectionMarkdown(section: DocSection): string {
  const parts = [`### ${section.title}`, ...(section.paragraphs ?? [])];
  if (section.diagram) parts.push(diagramText(section.diagram));
  if (section.steps) parts.push(section.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"));
  if (section.bullets) parts.push(section.bullets.map((bullet) => `- ${bullet}`).join("\n"));
  if (section.table) {
    const { headings, rows } = section.table;
    parts.push([
      `| ${headings.map(tableCell).join(" | ")} |`,
      `| ${headings.map(() => "---").join(" | ")} |`,
      ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`),
    ].join("\n"));
  }
  if (section.code) {
    const runs = section.code.match(/`+/g) ?? [];
    const fence = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
    parts.push(`${fence}\n${section.code}\n${fence}`);
  }
  if (section.links) parts.push(section.links.map((item) => `- ${link(item.href, item.label)}`).join("\n"));
  return parts.join("\n\n");
}

function pageMarkdown(page: DocPage): string {
  const parts = [
    `## ${page.title}`,
    `Source: ${new URL(docHref(page.slug), ORIGIN).href}`,
    page.description,
    ...page.sections.map(sectionMarkdown),
  ];
  if (page.slug === "api") parts.push("Every endpoint, parameter, request body, response and named schema is included in the complete OpenAPI document at the end of this export.");
  return parts.join("\n\n");
}

export function documentationMarkdown(): string {
  return [
    "# Fletch documentation",
    "Build an app, set up a watcher or use the API, with every guide and reference in reading order.",
    "## Contents",
    DOC_PAGES.map((page) => `- ${link(docHref(page.slug), page.title)}`).join("\n"),
    `Last verified against production: ${DOCS_VERIFIED_AT}. Live data has its own observation times.`,
    "## Documentation formats",
    [
      link("/docs/all", "All documentation on one page"),
      link("/llms-full.txt", "Complete documentation and API export"),
      link("/llms.txt", "Compact integration guide"),
      link("/api/v1/openapi.json", "OpenAPI JSON"),
      link("/skill.md", "AI integration skill"),
    ].map((item) => `- ${item}`).join("\n"),
    ...DOC_PAGES.map(pageMarkdown),
  ].join("\n\n") + "\n";
}
