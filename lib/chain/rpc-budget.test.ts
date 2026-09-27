import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetedRpcFetch } from "./rpc-budget";

test("metadata transport reserves each RPC method and never dispatches after daily denial", async function () {
  let credits = 3;
  let requests = 0;
  const fetchFn = budgetedRpcFetch(async () => { requests++; return new Response("{}"); }, async () => ({ ok: credits-- > 0 }));
  await fetchFn("https://example.invalid", { body: JSON.stringify([{ method: "eth_call" }, { method: "eth_getCode" }]) });
  assert.equal(credits, 1);
  assert.equal(requests, 1);
  await assert.rejects(fetchFn("https://example.invalid", { body: JSON.stringify([{ method: "eth_call" }, { method: "eth_getCode" }]) }), /Daily RPC budget/);
  assert.equal(requests, 1);
});

test("every viem retry attempt consumes budget, and metadata's zero-retry setting sends once", async function () {
  const { createPublicClient, http } = await import("viem");
  let reserved = 0;
  let dispatched = 0;
  const fetchFn = budgetedRpcFetch(async () => {
    dispatched++;
    return new Response("Unavailable", { status: 503 });
  }, async () => { reserved++; return { ok: true }; });
  const metadata = createPublicClient({ transport: http("https://example.invalid", { retryCount: 0, fetchFn }) });
  await assert.rejects(metadata.getBytecode({ address: `0x${"1".repeat(40)}` }));
  assert.equal(dispatched, 1);
  assert.equal(reserved, 1);
  const retrying = createPublicClient({ transport: http("https://example.invalid", { retryCount: 2, retryDelay: 1, fetchFn }) });
  await assert.rejects(retrying.getBytecode({ address: `0x${"2".repeat(40)}` }));
  assert.equal(dispatched, 4);
  assert.equal(reserved, 4, "transport-level retries must each reserve another RPC method");
});

test("viem HTTP batching reserves two methods for one network request", async function () {
  const { createPublicClient, http } = await import("viem");
  let reserved = 0;
  let dispatched = 0;
  const fetchFn = budgetedRpcFetch(async (_, init) => {
    dispatched++;
    const body = JSON.parse(String(init?.body)) as Array<{ id: number }>;
    assert.equal(body.length, 2);
    return new Response(JSON.stringify(body.map((row) => ({ jsonrpc: "2.0", id: row.id, result: "0x6000" }))), { headers: { "content-type": "application/json" } });
  }, async () => { reserved++; return { ok: true }; });
  const client = createPublicClient({ transport: http("https://example.invalid", { retryCount: 0, batch: true, fetchFn }) });
  await Promise.all([client.getBytecode({ address: `0x${"3".repeat(40)}` }), client.getBytecode({ address: `0x${"4".repeat(40)}` })]);
  assert.equal(dispatched, 1);
  assert.equal(reserved, 2);
});
