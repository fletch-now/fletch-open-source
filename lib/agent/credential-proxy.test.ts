import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import "@/lib/test-server-only";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { ProviderConfig } from "@/lib/agent/provider";

async function closeServer(server: Server): Promise<void> { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
test("credential proxy bounds the lease and keeps provider keys out of client replies", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function proxy(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const reserve = createServer();
  await new Promise<void>((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const proxyPort = (reserve.address() as AddressInfo).port;
  await closeServer(reserve);
  process.env.FORGE_PROXY_PORT = String(proxyPort);
  process.env.FORGE_PROXY_BIND = "127.0.0.1";
  const { leaseCredential } = await import("@/lib/agent/credential-proxy");
  const { revokeCredentialLeases } = await import("@/lib/agent/lease-revocation");
  const { close } = await import("@/lib/db");
  let requests = 0;
  let slow = false;
  let slowStarted: (() => void) | null = null;
  let slowClosed: (() => void) | null = null;
  const seen: Array<{ url: string; auth: string | undefined; body: Record<string, unknown> }> = [];
  const upstream = createServer(async function provider(req, res) {
    requests += 1;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    seen.push({ url: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString()) });
    if (slow) { res.once("close", () => slowClosed?.()); slowStarted?.(); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "reply", choices: [{ message: { role: "assistant", content: "private-provider-secret" }, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3 } }));
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const provider: ProviderConfig = { id: "kimi", model: "selected-model", apiKey: "private-provider-secret", baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`, bringYourOwnKey: false, inputPerMTok: 0, outputPerMTok: 0, credentialId: "credential-to-revoke" };
  const lease = await leaseCredential(provider, "local");
  function call(body: unknown, path = "/chat/completions", token = lease.token): Promise<Response> {
    return fetch(`${lease.baseUrl}${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  }
  const body = { model: "selected-model", messages: [{ role: "user", content: "Build an app" }], stream: true };
  try {
    await t.test("unknown lease, arbitrary paths, other models and image input never reach upstream", async function deny() {
      assert.equal((await call(body, "/chat/completions", "wrong")).status, 401);
      assert.equal((await call(body, "/files")).status, 404);
      assert.equal((await call({ ...body, model: "expensive-other-model" })).status, 400);
      assert.equal((await call({ ...body, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "file:///secret" } }] }] })).status, 400);
      assert.equal(requests, 0);
    });
    await t.test("real key is substituted only upstream and echoed secrets are redacted", async function substitute() {
      const response = await call(body);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(text.includes("[redacted]")); assert.ok(!text.includes(provider.apiKey)); assert.ok(!text.includes(lease.token));
      assert.equal(seen[0].auth, `Bearer ${provider.apiKey}`); assert.equal(seen[0].body.model, provider.model);
      assert.equal(seen[0].body.stream, false);
    });
    await t.test("a buffered request survives five minutes and ends before the SDK's ten-minute deadline", async function deadline(t) {
      slow = true;
      const deadlineLease = await leaseCredential({ ...provider, credentialId: "deadline-test" }, "local");
      t.mock.timers.enable({ apis: ["setTimeout"] });
      try {
        const reached = new Promise<void>((resolve) => { slowStarted = resolve; });
        let completed = false;
        const pending = call(body, "/chat/completions", deadlineLease.token).then((response) => { completed = true; return response; });
        await reached;
        t.mock.timers.tick(300_000);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(completed, false, "No former three-minute or fetch five-minute cutoff");
        t.mock.timers.tick(269_999);
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(completed, false);
        t.mock.timers.tick(1);
        const response = await pending;
        assert.equal(response.status, 400, "The installed CLI treats this status as terminal");
        const result = await response.text();
        assert.match(result, /exceeded the response time limit/);
        assert.equal(result.includes(provider.apiKey), false);
        assert.equal(deadlineLease.release().requests, 1);
      } finally {
        t.mock.timers.reset();
        deadlineLease.release();
      }
    });
    await t.test("build Stop immediately closes its in-flight upstream socket and revokes only its lease", { timeout: 2000 }, async function stop() {
      slow = true;
      const controller = new AbortController();
      const stoppedLease = await leaseCredential({ ...provider, credentialId: "stop-test" }, "local", controller.signal);
      const reached = new Promise<void>((resolve) => { slowStarted = resolve; });
      const disconnected = new Promise<void>((resolve) => { slowClosed = resolve; });
      const pending = call(body, "/chat/completions", stoppedLease.token);
      await reached;
      controller.abort();
      await disconnected;
      assert.equal((await pending).status, 502);
      assert.equal((await call(body, "/chat/completions", stoppedLease.token)).status, 401);
      assert.equal((await fetch(`${lease.baseUrl}/models`, { headers: { authorization: `Bearer ${lease.token}` } })).status, 200);
      assert.equal(stoppedLease.release().requests, 1);
      slowClosed = null;
    });
    await t.test("revocation aborts active requests and denies later requests", async function revoke() {
      slow = true;
      const reached = new Promise<void>((resolve) => { slowStarted = resolve; });
      const pending = call(body);
      await reached;
      assert.equal((await call(body)).status, 429);
      revokeCredentialLeases(provider.credentialId!);
      assert.equal((await pending).status, 502);
      assert.equal((await call(body)).status, 401);
      const totals = lease.release();
      assert.equal(totals.requests, 2); assert.equal(totals.reportedRequests, 1);
      assert.equal(totals.inputTokens, 12); assert.equal(totals.outputTokens, 3);
    });
  } finally {
    lease.release();
    await closeServer(upstream);
    const global = globalThis as typeof globalThis & { __fletchCredentialProxy?: { server?: Server } };
    if (global.__fletchCredentialProxy?.server) await closeServer(global.__fletchCredentialProxy.server);
    await close();
  }
});
