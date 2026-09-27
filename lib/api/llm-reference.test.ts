import assert from "node:assert/strict";
import { test } from "node:test";
import { fullApiReference } from "@/lib/api/llm-reference";
import { openApiDocument } from "@/lib/api/openapi";

test("the LLM copy retains every endpoint and referenced request/response schema", function complete() {
  const text = fullApiReference();
  const encoded = text.match(/```json\n([\s\S]*)\n```\n$/)?.[1];
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(encoded), openApiDocument);
  assert.ok(text.includes("HTTP 200 is not a claim that the data is current"));
  assert.ok(text.includes("X-Fletch-Signature"));
  assert.ok(text.includes("Build creation is a dashboard session operation"));
});

test("the public skill route wraps the shared guide without fetching data or copying a schema", async function skill(t) {
  const { integrationGuide, skillGuide } = await import("@/lib/api/llm-reference");
  const { GET } = await import("@/app/skill.md/route");
  const network = t.mock.method(globalThis, "fetch", async function noNetwork() { throw new Error("The guide must not fetch external data"); });
  const response = GET(new Request("https://fletch.now/skill.md"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("cache-control"), "public, max-age=300");
  const text = await response.text();
  assert.equal(text, skillGuide());
  assert.match(text, /^---\nname: fletch-robinhood-chain\ndescription: [^\n]+\n---\n\n/);
  assert.equal(text.split("\n---\n\n")[1], integrationGuide());
  assert.equal(text.includes("## Complete OpenAPI 3.1 reference"), false);
  assert.equal(network.mock.callCount(), 0);
});

test("the guide describes actual cursor, named-event and evidence boundaries", async function eventContract() {
  const { integrationGuide } = await import("@/lib/api/llm-reference");
  const { readFile } = await import("node:fs/promises");
  const events = await readFile(new URL("../../app/api/v1/chains/[chainId]/events/route.ts", import.meta.url), "utf8");
  const stream = await readFile(new URL("../../app/api/v1/chains/[chainId]/events/stream/route.ts", import.meta.url), "utf8");
  assert.match(events, /if \(cursor\) \{\s*const events = await authorityEventsAfter\(chainId, cursor, limit\)/);
  assert.ok(stream.includes('request.headers.get("last-event-id") ?? params.get("since")'));
  assert.ok(stream.includes('event: ${event.kind}'));
  const guide = integrationGuide();
  for (const term of ["filters client-side", "Last-Event-ID takes precedence", "onmessage alone", "block and txHash may be", "check\n/status independently", "not proof of fraudulent intent", "five-hour app build remain unverified"]) {
    assert.ok(guide.includes(term), term);
  }
});

test("changelog JSON discovery preserves canonical, feeds, cards and robots", async function seo() {
  const { canonical, pageMetadata, publicPageMetadata } = await import("@/lib/seo");
  const { PUBLIC_PAGES } = await import("@/lib/seo-pages");
  const page = PUBLIC_PAGES["/registry/changes"];
  const before = pageMetadata("/registry/changes", page.title, page.description);
  const after = publicPageMetadata("/registry/changes");
  assert.equal(after.alternates?.canonical, before.alternates?.canonical);
  assert.deepEqual(after.openGraph, before.openGraph);
  assert.deepEqual(after.twitter, before.twitter);
  assert.deepEqual(after.robots, before.robots);
  assert.deepEqual(after.alternates?.types, {
    "application/atom+xml": canonical("/registry/changes.xml"),
    "application/rss+xml": canonical("/registry/feed.xml"),
    "application/json": canonical("/api/v1/chains/4663/events"),
  });
  assert.equal(publicPageMetadata("/registry").alternates?.types?.["application/json"], undefined);
});


test("package approvals remain dashboard operations and do not imply published prices", async function pricingScope() {
  const { integrationGuide, skillGuide, fullApiReference } = await import("@/lib/api/llm-reference");
  const { openApiDocument } = await import("@/lib/api/openapi");
  for (const text of [integrationGuide(), skillGuide(), fullApiReference()]) {
    assert.ok(text.includes("/api/build-quotes"));
    assert.ok(text.includes("/api/builds/:id/budget"));
    assert.ok(text.includes("No package prices are currently enabled"));
    assert.ok(text.includes("supported initial coding stage"));
  }
  assert.equal("/build-quotes" in openApiDocument.paths, false);
  assert.equal("/builds/{id}/budget" in openApiDocument.paths, false);
  assert.ok("/chains/{chainId}/markets/filters" in openApiDocument.paths);
});
