import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { build } from "esbuild";

test("discovery RSS uses address identity, escapes token metadata and reports source failure", async function feed() {
  let unavailable = false;
  const token = {
    address: `0x${"1".repeat(40)}`, symbol: "SAME<&", name: "Token\u0001<script>",
    source: "contract_metadata", firstSeenAt: "2026-09-15T08:00:00.000Z", metadataCheckedAt: "2026-09-15T08:01:00.000Z",
    trust: { level: "community", label: "Community", detail: "Contract metadata read. Identity is unverified." },
  };
  const fixture = async () => {
    if (unavailable) throw new Error("Controlled database failure");
    return { asOf: "2026-09-15T08:02:00.000Z", items: [token, { ...token, address: `0x${"2".repeat(40)}` }] };
  };
  const bundled = await build({
    entryPoints: ["app/registry/feed.xml/route.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external",
    plugins: [{ name: "discovery-reader", setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/registry\/discoveries$/ }, () => ({ path: "discoveries", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'export const tokenDiscoveries = fixture; export const DISCOVERY_SCOPE = "Recorded by Fletch; discovery is not deployment.";' }));
    } }],
  });
  const compiled = { exports: {} as { GET: () => Promise<Response> } };
  new Function("require", "module", "exports", "fixture", bundled.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports, fixture);
  const response = await compiled.exports.GET();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "public, max-age=15");
  const xml = await response.text();
  assert.match(xml, /SAME&lt;&amp;/);
  assert.doesNotMatch(xml, /<script>|\u0001/);
  assert.equal((xml.match(/<guid /g) ?? []).length, 2, "same-symbol contracts have separate feed entries");
  assert.match(xml, new RegExp(`/registry/markets/${token.address}`));
  assert.match(xml, /<pubDate>Tue, 15 Sep 2026 08:00:00 GMT<\/pubDate>/);
  assert.match(xml, /Metadata checked: 2026-09-15T08:01:00.000Z/);
  unavailable = true;
  const failed = await compiled.exports.GET();
  assert.equal(failed.status, 503, "reader failure cannot look like a successful empty feed");
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.equal(failed.headers.get("retry-after"), "30");
});
