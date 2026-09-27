import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { getChainClient, getDaemonClient, getMarketReadClient, getMetadataClient, getLogClient, getLogRpcUrl, getRpcUrl, PUBLIC_RPC_URLS, usingPublicLogRpc, usingPublicRpc } from "./rpc";
import { createDedicatedFetch } from "./pace";

test("state and log providers are explicit and report public fallback truthfully", function () {
  const saved = [process.env.RPC_URL_4663, process.env.RPC_LOG_URL_4663];
  try {
    process.env.RPC_URL_4663 = " https://rpc.example/v2/test-key ";
    process.env.RPC_LOG_URL_4663 = PUBLIC_RPC_URLS[4663];
    assert.equal(getRpcUrl(4663), "https://rpc.example/v2/test-key");
    assert.equal(usingPublicRpc(4663), false);
    assert.equal(usingPublicLogRpc(4663), true);
    assert.equal(getChainClient(4663).transport.timeout, 4_000);
    assert.equal(getLogClient(4663, false).transport.timeout, 4_000);
    assert.equal(getLogClient(4663, true).transport.timeout, 600_000);
    assert.notEqual(getLogClient(4663, false), getLogClient(4663, true));
    delete process.env.RPC_LOG_URL_4663;
    assert.equal(getLogRpcUrl(4663), getRpcUrl(4663));
    assert.equal(usingPublicLogRpc(4663), false);
    process.env.RPC_URL_4663 = " ";
    assert.equal(usingPublicRpc(4663), true);
  } finally {
    for (const [index, name] of ["RPC_URL_4663", "RPC_LOG_URL_4663"].entries()) {
      if (saved[index] === undefined) delete process.env[name];
      else process.env[name] = saved[index];
    }
  }
});

test("dedicated requests serialize and a failed request releases the queue", async function (t) {
  let active = 0;
  let peak = 0;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async function () {
    active += 1;
    peak = Math.max(peak, active);
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (calls === 1) throw new Error("fixture transport failure");
    return new Response("{}");
  });
  const fetch = createDedicatedFetch(1);
  const results = await Promise.allSettled([fetch("https://rpc.example"), fetch("https://rpc.example"), fetch("https://rpc.example")]);
  assert.equal(peak, 1);
  assert.deepEqual(results.map((result) => result.status), ["rejected", "fulfilled", "fulfilled"]);
});


test("blocked legacy and market requests cannot starve the independent metadata lane", { timeout: 8_000 }, async function () {
  const saved = process.env.RPC_URL_46630;
  let legacyResponse: ServerResponse | undefined;
  let heldMarketResponse: ServerResponse | undefined;
  let releaseMarketStarted!: () => void;
  const marketStarted = new Promise<void>((resolve) => { releaseMarketStarted = resolve; });
  let releaseStarted!: () => void;
  const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
  const marketStarts: number[] = [];
  let requests = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as { id: number; method: string };
    requests++;
    response.setHeader("content-type", "application/json");
    if (requests === 1) {
      legacyResponse = response;
      releaseStarted();
      return;
    }
    if (rpc.method === "eth_blockNumber") {
      heldMarketResponse = response;
      releaseMarketStarted();
      return;
    }
    marketStarts.push(Date.now());
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: "0xb626" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  let legacy: Promise<number> | undefined;
  let heldMarket: Promise<bigint> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    process.env.RPC_URL_46630 = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    legacy = getDaemonClient(46630).getChainId();
    await started;
    let budgetChecks = 0;
    const market = getMarketReadClient(46630, async () => { budgetChecks++; return { ok: true }; });
    const first = await Promise.race([
      market.getChainId(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Market request waited behind blocked legacy request")), 1_500); }),
    ]);
    clearTimeout(deadline);
    assert.equal(first, 46630);
    assert.equal(legacyResponse?.writableEnded, false, "legacy request remains blocked while market response arrives");
    const otherMarketClient = getMarketReadClient(46630, async () => { budgetChecks++; return { ok: true }; });
    assert.equal(await otherMarketClient.getChainId(), 46630);
    assert.ok(marketStarts[1] - marketStarts[0] >= 180, "different market clients share the 200ms paced lane");
    assert.equal(budgetChecks, 2);
    const denied = getMarketReadClient(46630, async () => ({ ok: false }));
    await assert.rejects(denied.getChainId(), /Daily RPC budget reached/);
    assert.equal(requests, 3, "denied budget never reaches the network");
    heldMarket = market.getBlockNumber({ cacheTime: 0 });
    await marketStarted;
    const metadata = getMetadataClient(46630, async () => ({ ok: true }));
    assert.equal(metadata.transport.timeout, 15_000);
    assert.equal(metadata.transport.retryCount, 0);
    assert.equal(market.transport.retryCount, 0);
    const metadataResult = await Promise.race([
      metadata.getChainId(),
      new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("Metadata waited behind another lane")), 1_500); }),
    ]);
    clearTimeout(deadline);
    assert.equal(metadataResult, 46630);
    assert.equal(heldMarketResponse?.writableEnded, false);
    assert.equal(legacyResponse?.writableEnded, false);
    assert.equal(await getMetadataClient(46630, async () => ({ ok: true })).getChainId(), 46630);
    assert.ok(marketStarts[3] - marketStarts[2] >= 180, "metadata clients share their own 200ms pacing");
    assert.equal(budgetChecks, 3, "all dispatched market RPC calls charge the persistent budget");
  } finally {
    clearTimeout(deadline);
    legacyResponse?.end(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "0xb626" }));
    heldMarketResponse?.end(JSON.stringify({ jsonrpc: "2.0", id: 0, result: "0x64" }));
    await legacy?.catch(() => undefined);
    await heldMarket?.catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (saved === undefined) delete process.env.RPC_URL_46630;
    else process.env.RPC_URL_46630 = saved;
  }
});
