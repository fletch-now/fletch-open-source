import assert from "node:assert/strict";
import { test } from "node:test";
import { DOC_PAGES, DOCS_VERIFIED_AT, docHref } from "@/lib/docs/content";
import { fullApiReference } from "@/lib/api/llm-reference";
import { openApiDocument } from "@/lib/api/openapi";
import { GET } from "@/app/llms-full.txt/route";
import { docDiagrams, diagramText } from "@/lib/docs/diagrams";

test("the complete export includes every product page, guide element and unchanged OpenAPI contract", function completeDocument() {
  const text = fullApiReference();
  const index = text.slice(0, text.indexOf(`\n## ${DOC_PAGES[0].title}`));
  assert.ok(index.includes(DOCS_VERIFIED_AT));
  for (const page of DOC_PAGES) {
    if (page.slug !== "api") assert.ok(page.sections.length, `${page.slug}: manual omitted from shared export`);
    assert.ok(index.includes(`https://fletch.now${docHref(page.slug)}`), `Missing index URL: ${page.slug}`);
    assert.ok(text.includes(`## ${page.title}\n`), `Missing page: ${page.slug}`);
    assert.ok(text.includes(page.description));
    for (const section of page.sections) {
      if (section.diagram) assert.ok(text.includes(diagramText(section.diagram)), `${page.slug}: diagram missing from text export`);
      assert.ok(text.includes(`### ${section.title}`));
      for (const value of [...section.paragraphs ?? [], ...section.steps ?? [], ...section.bullets ?? []]) assert.ok(text.includes(value), `${page.slug}: missing content`);
      if (section.code) assert.ok(text.includes(section.code), `${page.slug}: truncated example`);
      if (section.table) {
        for (const value of [...section.table.headings, ...section.table.rows.flat()]) assert.ok(text.includes(value.replaceAll("|", "\\|").replaceAll("\n", "<br>")), `${page.slug}: missing table value`);
      }
      for (const item of section.links ?? []) assert.ok(text.includes(new URL(item.href, "https://fletch.now").href), `${page.slug}: missing absolute link`);
    }
  }
  const schema = text.split("## Complete OpenAPI 3.1 reference\n\n```json\n")[1];
  assert.ok(schema);
  assert.deepEqual(JSON.parse(schema.slice(0, schema.lastIndexOf("\n```"))), openApiDocument);
  assert.equal([...text.matchAll(/\]\(\//g)].length, 0, "Export links must work outside the website");
});

test("the documentation includes each diagram and every next-page link resolves", function navigation() {
  const slugs = new Set(DOC_PAGES.map((page) => page.slug));
  assert.equal(slugs.size, DOC_PAGES.length, "Duplicate docs routes");
  for (const page of DOC_PAGES) assert.ok(slugs.has(page.next), `${page.slug}: next page missing`);
  const referenced = new Set(DOC_PAGES.flatMap((page) => page.sections.flatMap((section) => section.diagram ? [section.diagram] : [])));
  assert.deepEqual([...referenced].sort(), Object.keys(docDiagrams).sort());
});

test("the full document is public, retrievable without JavaScript and must revalidate after a release", async function publicExport(t) {
  const network = t.mock.method(globalThis, "fetch", async function noNetwork() { throw new Error("Export must use the published sources without fetching data"); });
  const response = GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(await response.text(), fullApiReference());
  assert.equal(network.mock.callCount(), 0);
});

test("Build, Watch and API quickstarts lead every docs index in the same chapter order", async function builderFirst() {
  const { integrationGuide, skillGuide } = await import("@/lib/api/llm-reference");
  const { readFile } = await import("node:fs/promises");
  const expected = ["quickstart-build", "quickstart-watch", "quickstart-api", "", "why", "build", "watch", "markets", "registry-reading", "trust", "truth-oracle", "compiler", "infrastructure", "persistence", "agents", "api", "limits", "roadmap", "faq", "webhooks", "mcp"];
  assert.deepEqual(DOC_PAGES.map((page) => page.slug), expected);
  for (const [index, page] of DOC_PAGES.entries()) {
    assert.equal(page.next, expected[index + 1] ?? "quickstart-build", `${page.slug}: reading order differs from navigation`);
  }
  for (const text of [fullApiReference(), integrationGuide(), skillGuide()]) {
    let position = -1;
    for (const slug of expected.slice(0, 3)) {
      const page = DOC_PAGES.find((page) => page.slug === slug)!;
      const next = text.indexOf(page.title);
      assert.ok(next > position, `${slug}: quickstart order differs`);
      position = next;
    }
    for (const page of DOC_PAGES) assert.ok(text.includes(`https://fletch.now${docHref(page.slug)}`));
  }
  const layout = await readFile(new URL("../../app/docs/layout.tsx", import.meta.url), "utf8");
  assert.ok(layout.includes("DOC_PAGES.map"), "Sidebar must use the canonical index");
  assert.equal(layout.includes("<DocsAiAccess"), false, "Shared layout must not precede the combined title and contents");
  const combined = await readFile(new URL("../../app/docs/all/page.tsx", import.meta.url), "utf8");
  const titleAt = combined.indexOf("<DocsTitle");
  const contentsAt = combined.indexOf('<nav aria-label="All documentation contents"');
  const aiAt = combined.indexOf("<DocsAiAccess");
  const countersAt = combined.indexOf("<DocsLiveNumbers");
  assert.ok(titleAt < contentsAt && contentsAt < aiAt && aiAt < countersAt);
  assert.ok(combined.includes('page.slug === "registry-reading" ? <DocsLiveNumbers />'));
  const overview = await readFile(new URL("../../app/docs/page.tsx", import.meta.url), "utf8");
  assert.equal(overview.includes("DocsLiveNumbers"), false);
});

test("the roadmap describes capabilities without release bookkeeping or admin operations", function roadmapCopy() {
  const page = DOC_PAGES.find((page) => page.slug === "roadmap")!;
  assert.deepEqual(page.sections.map((section) => section.title), ["Shipped", "Now", "Next", "Later"]);
  const text = JSON.stringify(page);
  assert.doesNotMatch(text, /recorded releases|counts once|release count|planning rhythm|review.*weekly|admin pric|checkout|—/i);
  for (const topic of ["maximum budget", "Multi-contract", "npm", "USDG", "gallery", "$19/month", "$FLETCH"]) assert.ok(text.includes(topic), topic);
});
