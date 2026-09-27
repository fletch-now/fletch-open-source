import assert from "node:assert/strict";
import { test } from "node:test";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";

test("JSON body limit counts actual chunked UTF-8 bytes and cancels excess input", async function chunked() {
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoder.encode('{"text":"')); controller.enqueue(encoder.encode("😀".repeat(100))); }, cancel() { cancelled = true; } });
  const request = new Request("http://localhost/api/builds", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  await assert.rejects(readBoundedJson(request, 100), RequestBodyTooLargeError);
  assert.equal(cancelled, true);
});
test("valid JSON is preserved and malformed JSON returns null", async function json() {
  assert.deepEqual(await readBoundedJson(new Request("http://localhost", { method: "POST", body: '{"prompt":"build"}' }), 100), { prompt: "build" });
  assert.equal(await readBoundedJson(new Request("http://localhost", { method: "POST", body: "{" }), 100), null);
});

test("bodyless grant checks accept empty streams and reject even one supplied byte", async () => {
  const empty = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const request = new Request("http://localhost/api/credits/holder", { method: "POST", body: empty, duplex: "half" } as RequestInit);
  assert.deepEqual(await readBoundedJson(request, 0, { allowEmpty: true }), {});
  for (const body of [" ", "{}", '{"credits":999}']) {
    await assert.rejects(readBoundedJson(new Request("http://localhost", { method: "POST", body }), 0, { allowEmpty: true }), RequestBodyTooLargeError);
  }
});

test("optional empty POSTs work with no body or an HTTP adapter's empty stream", async function optionalEmpty() {
  function request(body?: string): Request { return new Request("http://localhost/api/builds/example/cancel", { method: "POST", body }); }
  assert.deepEqual(await readBoundedJson(request(), 1024, { allowEmpty: true }), {});
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const proxied = new Request("http://localhost/api/builds/example/cancel", { method: "POST", body: stream, duplex: "half" } as RequestInit);
  assert.notEqual(proxied.body, null);
  assert.deepEqual(await readBoundedJson(proxied, 1024, { allowEmpty: true }), {});
  assert.equal(await readBoundedJson(request(""), 1024), null);
  for (const body of ["{", "null", " "]) {
    assert.equal(await readBoundedJson(request(body), 1024, { allowEmpty: true }), null);
  }
  assert.deepEqual(await readBoundedJson(request('{"queuedOnly":false}'), 1024, { allowEmpty: true }), { queuedOnly: false });
  assert.deepEqual(await readBoundedJson(request('{"queuedOnly":true}'), 1024, { allowEmpty: true }), { queuedOnly: true });
  await assert.rejects(readBoundedJson(request("x".repeat(1025)), 1024, { allowEmpty: true }), RequestBodyTooLargeError);
});
