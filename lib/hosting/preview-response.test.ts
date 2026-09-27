import assert from "node:assert/strict";
import { test } from "node:test";
import { previewResponse } from "./preview-response";

test("preview documents remain sandboxed on direct navigation and keep their standards mode", async function document() {
  const response = previewResponse(Buffer.from('<!doctype html><html><head></head><body><script type="module" src="./app.js"></script></body></html>'), "index.html", "https://fletch.now");
  const body = await response.text();
  assert.match(body, /^<!doctype html><script nonce="[A-Za-z0-9+/]+">/);
  const policy = response.headers.get("content-security-policy")!;
  assert.match(policy, /sandbox allow-scripts;/);
  assert.doesNotMatch(policy, /allow-same-origin|script-src[^;]*unsafe-inline/);
  assert.match(policy, /form-action 'none'/);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(response.headers.get("access-control-allow-credentials"), null);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.match(body, /window.__FLETCH_DRAFT_PREVIEW__/);
});

test("preview asset bytes stay identical to the publish bundle and use bounded private caching", async function asset() {
  const bytes = Buffer.from("export const value = 42;");
  const response = previewResponse(bytes, "assets/app.js", "https://fletch.now");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal(response.headers.get("cache-control"), "private, max-age=300");
  assert.match(response.headers.get("content-type")!, /javascript/);
});
