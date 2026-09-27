import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { BlockscoutEndpointError, BlockscoutUnavailableError, configureBlockscoutAccounting, parseExplorerCursor, searchTokenPage, searchTokens, tokenInfo } from "./blockscout";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const KEY = "proapi_synthetic_test_only";

function setKey(t: TestContext, key?: string): void {
  const previous = process.env.BLOCKSCOUT_API_KEY;
  if (key === undefined) delete process.env.BLOCKSCOUT_API_KEY;
  else process.env.BLOCKSCOUT_API_KEY = key;
  t.after(function restore() {
    if (previous === undefined) delete process.env.BLOCKSCOUT_API_KEY;
    else process.env.BLOCKSCOUT_API_KEY = previous;
  });
}

test("Blockscout PRO uses the fixed Robinhood API host and a header-only key", async function (t) {
  setKey(t, ` ${KEY} `);
  t.mock.method(globalThis, "fetch", async function read(url: string | URL | Request, options?: RequestInit) {
    assert.equal(String(url), `https://api.blockscout.com/4663/api/v2/tokens/${ADDRESS}`);
    assert.equal(String(url).includes(KEY), false);
    assert.equal(new Headers(options?.headers).get("authorization"), `Bearer ${KEY}`);
    assert.equal(options?.redirect, "error", "credentials must not follow redirects");
    return Response.json({ address_hash: ADDRESS, symbol: "TEST", holders_count: "4" });
  });
  assert.equal((await tokenInfo(ADDRESS))?.holders, 4);
});

test("Blockscout without a key retains anonymous access without Authorization", async function (t) {
  setKey(t);
  t.mock.method(globalThis, "fetch", async function read(url: string | URL | Request, options?: RequestInit) {
    assert.equal(String(url), "https://robinhoodchain.blockscout.com/api/v2/tokens?q=TEST&type=ERC-20");
    assert.equal(new Headers(options?.headers).has("authorization"), false);
    return Response.json({ items: [] });
  });
  assert.deepEqual(await searchTokens("TEST"), []);
});

for (const status of [401, 402, 403]) {
  test(`Blockscout PRO HTTP ${status} stops without retry, fallback or secret disclosure`, async function (t) {
    setKey(t, KEY);
    let calls = 0;
    let cancelled = false;
    t.mock.method(globalThis, "fetch", async function refused(url: string | URL | Request) {
      calls++;
      assert.equal(new URL(String(url)).host, "api.blockscout.com");
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status, headers: { "content-type": "application/json" } });
    });
    await assert.rejects(tokenInfo(ADDRESS), function denied(error: unknown) {
      assert.ok(error instanceof BlockscoutUnavailableError);
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.equal(error.message.includes(KEY), false);
      assert.equal(error.message.includes("Bearer"), false);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(cancelled, true);
  });
}


for (const status of [500, 502]) test(`Blockscout HTTP ${status} retains a safe endpoint path instead of becoming a credential-wide denial`, async function (t) {
  setKey(t, KEY);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async function failed() {
    calls++;
    return status === 502 ? new Response("Bad Gateway", { status, headers: { "content-type": "text/html" } }) : Response.json({ error: "server failure" }, { status });
  });
  await assert.rejects(tokenInfo(ADDRESS), function endpointFailure(error: unknown) {
    assert.ok(error instanceof BlockscoutEndpointError);
    assert.equal(error instanceof BlockscoutUnavailableError, false);
    assert.equal(error.status, status);
    assert.equal(error.path, `/tokens/${ADDRESS}`);
    assert.equal(error.message.includes(KEY), false);
    return true;
  });
  assert.equal(calls, 2, "one bounded retry still applies to an upstream server failure");
});

test("catalog search validates pagination and refuses schema loss or a repeated page", async function (t) {
  setKey(t, KEY);
  const cursor = { q: "TEST", contract_address_hash: ADDRESS, items_count: 50 };
  let body: unknown = { items: [{ address_hash: ADDRESS, symbol: "TEST" }], next_page_params: cursor };
  t.mock.method(globalThis, "fetch", async function page(input: RequestInfo | URL) {
    assert.equal(new URL(String(input)).searchParams.get("q"), "TEST");
    return Response.json(body);
  });
  const page = await searchTokenPage("TEST");
  assert.equal(page.items[0].address, ADDRESS);
  await assert.rejects(searchTokenPage("TEST", cursor), /did not advance/);
  body = { results: [] };
  await assert.rejects(searchTokenPage("TEST"), /schema changed/);
  assert.throws(() => parseExplorerCursor({ apikey: "unexpected" }), /schema changed/);
  assert.throws(() => parseExplorerCursor({}), /empty pagination/);
  await assert.rejects(searchTokenPage("OTHER", cursor), /changed the search symbol/);
});

test("pagination preserves null sort keys so the explorer advances past the first page", async function (t) {
  setKey(t, KEY);
  const cursor = { q: "TEST", contract_address_hash: ADDRESS, items_count: 50, fiat_value: null,
    market_cap: null, holders_count: 0, name: null, is_name_null: true };
  const nextAddress = `0x${"2".repeat(40)}`;
  t.mock.method(globalThis, "fetch", async function page(input: RequestInfo | URL) {
    const query = new URL(String(input)).searchParams;
    assert.equal(query.get("fiat_value"), "");
    assert.equal(query.get("market_cap"), "");
    assert.equal(query.get("name"), "");
    assert.equal(query.get("holders_count"), "0");
    assert.equal(query.get("is_name_null"), "true");
    assert.equal(query.get("contract_address_hash"), ADDRESS);
    assert.equal(query.get("q"), "TEST");
    return Response.json({ items: [{ address_hash: nextAddress, symbol: "TEST" }],
      next_page_params: { ...cursor, contract_address_hash: nextAddress, is_name_null: false } });
  });
  const result = await searchTokenPage("TEST", cursor);
  assert.equal(result.items[0].address, nextAddress);
  assert.equal(result.next?.contract_address_hash, nextAddress);
  assert.equal(result.next?.market_cap, null, "the durable cursor retains upstream null semantics");
});

test("persistent request denial prevents transport dispatch", async function (t) {
  configureBlockscoutAccounting({ async beforeRequest() { throw new Error("Fixture daily limit"); }, async afterResponse() {} });
  t.after(() => configureBlockscoutAccounting(null));
  let dispatched = false;
  t.mock.method(globalThis, "fetch", async function forbidden() { dispatched = true; return Response.json({}); });
  await assert.rejects(tokenInfo(ADDRESS), /Fixture daily limit/);
  assert.equal(dispatched, false);
});
