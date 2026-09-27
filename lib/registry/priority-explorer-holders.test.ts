import assert from "node:assert/strict";
import { test } from "node:test";
import { NATIVE_HOLDERS_REASON, parseExplorerHolders, readExplorerHolders, readPriorityHolders } from "./priority-explorer-holders";

// Minimal server-rendered label/contract structure observed on public Robinscan pages on 2026-09-09.
const cashcat = "0x020bfc650a365f8bb26819deaabf3e21291018b4";
const pipedog = "0x5cb6f181081301b44905f3ae15419112ecabd8a6";
const pons = "0x39dbed3a2bd333467115de45665cc57f813c4571";
function page(address: string, count: string): string {
  return `<p>Chain ID <!-- -->4663</p><h1>Token name (SYMBOL)</h1><div>Contract</div><div><span><a title="${address}" href="/address/${address}">${address}</a></span></div><div>Holders</div><div class="count">${count}</div><table><tbody><tr><td>1</td></tr></tbody></table>`;
}

test("holder parser binds the full contract identity and labeled total, never the displayed table length", function labeledCounts() {
  for (const [address, count, value] of [[cashcat, "109,970", 109970], [pipedog, "8,596", 8596], [pons, "89,587", 89587]] as const) {
    assert.equal(parseExplorerHolders(page(address, count), address), value);
  }
  assert.equal(parseExplorerHolders(page(cashcat.toUpperCase().replace("0X", "0x"), "0"), cashcat), 0);
  assert.equal(parseExplorerHolders(page(cashcat, "109,970"), pipedog), null);
  assert.equal(parseExplorerHolders(page(cashcat, "109,970").replace("4663", "46630"), cashcat), null);
  assert.equal(parseExplorerHolders(page(cashcat, "109,970").replace(`>${cashcat}</a>`, `>${pipedog}</a>`), cashcat), null);
  assert.equal(parseExplorerHolders(`<script>${page(cashcat, "109,970")}</script>`, cashcat), null);
  assert.equal(parseExplorerHolders(page(cashcat, "109,970") + '<div>Holders</div><div>2</div>', cashcat), null);
  for (const count of ["1,23", "NaN", "-1", "1.5", "12K", "9007199254740992"]) assert.equal(parseExplorerHolders(page(cashcat, count), cashcat), null);
  assert.equal(parseExplorerHolders(page(cashcat, "1") + "x".repeat(2 * 1024 * 1024), cashcat), null);
});

test("public holder fetch fixes host and network, bounds its body, and labels fetch time without block freshness", async function boundedFetch() {
  let calls = 0;
  const fetcher: typeof fetch = async function publicPage(input, init) {
    calls += 1;
    assert.equal(String(input), `https://www.robinscan.net/token/${cashcat}`);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.ok(init?.signal);
    return new Response(page(cashcat, "109,970"), { headers: { "content-type": "text/html" } });
  };
  assert.equal((await readExplorerHolders(1, cashcat, fetcher)).value, null);
  assert.equal((await readExplorerHolders(4663, "https://elsewhere.invalid", fetcher)).value, null);
  assert.equal((await readExplorerHolders(4663, "0x0000000000000000000000000000000000000000", fetcher)).reason, NATIVE_HOLDERS_REASON);
  assert.equal(calls, 0);
  const started = Date.now();
  const result = await readExplorerHolders(4663, cashcat, fetcher);
  assert.equal(result.value, 109970);
  assert.ok(Date.parse(result.asOf!) >= started);
  assert.match(result.source, /source index snapshot time is not published/);
  assert.match(result.source, new RegExp(cashcat));
  assert.equal(result.blockNumber, null);
  assert.equal(result.blockHash, null);
  const failed = await readExplorerHolders(4663, cashcat, async () => new Response("Payment required", { status: 402, headers: { "content-type": "text/html" } }));
  assert.equal(failed.value, null);
  assert.match(failed.reason!, /HTTP 402/);
  const tooLarge = await readExplorerHolders(4663, cashcat, async () => new Response("x".repeat(2 * 1024 * 1024 + 1), { headers: { "content-type": "text/html" } }));
  assert.equal(tooLarge.value, null);
  assert.match(tooLarge.reason!, /2 MiB response limit/);
  const timeout = await readExplorerHolders(4663, cashcat, async () => { throw new DOMException("Timeout", "TimeoutError"); });
  assert.equal(timeout.value, null);
  assert.match(timeout.reason!, /12-second request timeout/);
});


test("public holder reads reject overlap rather than multiply explorer requests", async function singleRead() {
  let release!: () => void;
  let started!: () => void;
  const dispatched = new Promise<void>((resolve) => { started = resolve; });
  const first = readExplorerHolders(4663, cashcat, async () => {
    started();
    await new Promise<void>((resolve) => { release = resolve; });
    return new Response(page(cashcat, "1"), { headers: { "content-type": "text/html" } });
  });
  await dispatched;
  let secondDispatched = false;
  const second = await readExplorerHolders(4663, pipedog, async () => {
    secondDispatched = true;
    return new Response(page(pipedog, "2"), { headers: { "content-type": "text/html" } });
  });
  assert.equal(second.value, null);
  assert.match(second.reason!, /already in progress/);
  assert.equal(secondDispatched, false);
  release();
  assert.equal((await first).value, 1);
});

test("configured holder reads use the authenticated counters API and retain unknown index time", async function api(t) {
  const previous = process.env.BLOCKSCOUT_API_KEY;
  process.env.BLOCKSCOUT_API_KEY = "proapi_fixture";
  t.after(function restore() {
    if (previous === undefined) delete process.env.BLOCKSCOUT_API_KEY;
    else process.env.BLOCKSCOUT_API_KEY = previous;
  });
  let status = 200;
  let value: unknown = "42";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async function response(input: RequestInfo | URL, init?: RequestInit) {
    calls++;
    assert.equal(String(input), `https://api.blockscout.com/4663/api/v2/tokens/${cashcat}/counters`);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer proapi_fixture");
    return Response.json({ token_holders_count: value }, { status });
  });
  const observed = await readPriorityHolders(4663, cashcat);
  assert.equal(observed.value, 42); assert.equal(observed.blockNumber, null); assert.equal(observed.blockHash, null);
  assert.match(observed.source, /index snapshot time is unpublished/);
  assert.ok(observed.asOf);
  value = null;
  assert.equal((await readPriorityHolders(4663, cashcat)).value, null);
  status = 402;
  assert.match((await readPriorityHolders(4663, cashcat)).reason!, /HTTP 402/);
  const before = calls;
  assert.equal((await readPriorityHolders(4663, `0x${"0".repeat(40)}`)).reason, NATIVE_HOLDERS_REASON);
  assert.equal(calls, before);
});
