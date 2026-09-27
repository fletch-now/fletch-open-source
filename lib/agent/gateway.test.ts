import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

test("local gateway rejects replay, excess budgets, upstream overrides and secret echoes", async function policy() {
  const policy = await import(pathToFileURL(resolve("packages/fletch-gateway/policy.mjs")).href);
  const task = { id: randomUUID(), buildId: randomUUID(), projectId: randomUUID(), projectName: "App", responseToken: "a".repeat(43), provider: "openai", model: "gpt-5.2", expiresAt: new Date(Date.now() + 60_000).toISOString(), requestExpiresAt: new Date(Date.now() + 60_000).toISOString(), maxRequests: 400, maxOutputTokens: 16384, payload: { path: "/responses", body: { model: "gpt-5.2", input: [{ role: "user", content: "Build an app" }], store: false, max_output_tokens: 1200 } } };
  const connection = { provider: "openai", model: "gpt-5.2" };
  assert.equal(policy.validateTask(task, connection).buildId, task.buildId);
  for (const changed of [
    { ...task, provider: "kimi" }, { ...task, model: "other-model" },
    { ...task, expiresAt: new Date(Date.now() - 1000).toISOString() },
    { ...task, payload: { ...task.payload, path: "https://evil.invalid/v1/files" } },
    { ...task, payload: { ...task.payload, headers: { authorization: "steal-key" } } },
    { ...task, payload: { ...task.payload, body: { ...task.payload.body, max_output_tokens: 999999 } } },
    { ...task, payload: { ...task.payload, body: { ...task.payload.body, tools: [{ type: "web_search" }] } } },
    { ...task, payload: { ...task.payload, body: { ...task.payload.body, input: [{ type: "input_file", file_id: "provider-account-file" }] } } },
  ]) assert.throws(() => policy.validateTask(changed, connection));
  const approval = { binding: policy.approvalBinding(task), used: 0, maxRequests: 1, expiresAt: Date.now() + 60_000 };
  const seen = new Set();
  policy.consumeApproval(task, approval, seen);
  assert.throws(() => policy.consumeApproval(task, approval, seen));
  assert.throws(() => policy.consumeApproval({ ...task, id: randomUUID() }, approval, seen));
  assert.throws(() => policy.consumeApproval({ ...task, projectId: randomUUID() }, { ...approval, used: 0 }, new Set()));
  assert.equal(policy.sanitized("provider-secret relay-secret", ["provider-secret", "relay-secret"]), "[redacted] [redacted]");
});
test("gateway pairing and build relay never require a provider key", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function gateway(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, builds, creditEvents, modelGateways, gatewayRequests } = await import("@/lib/db/schema");
  const { createGateway, pairGateway, authenticatedGateway, claimGatewayRequest, completeGatewayRequest, revokeGateway } = await import("@/lib/agent/gateway");
  const { createBuildWithCredit } = await import("@/lib/build/create");
  const { listModelKeys, providerForBuild } = await import("@/lib/agent/user-keys");
  const { requestAgent, newTransportContext } = await import("@/lib/agent/provider-transport");
  const owner = randomUUID(), other = randomUUID();
  let createdId = "";
  try {
    await db.insert(user).values([{ id: owner }, { id: other }]);
    const created = await createGateway(owner, "openai", "gpt-5.2", "My laptop"); createdId = created.id;
    const paired = await pairGateway(created.pairingToken); assert.ok(paired);
    await t.test("pairing is one-use and only a token digest is stored", async function pairing() {
      assert.equal(await pairGateway(created.pairingToken), null);
      assert.equal((await authenticatedGateway(paired.token))?.userId, owner);
      const [stored] = await db.select().from(modelGateways).where(eq(modelGateways.id, paired.id));
      assert.equal(stored.pairingHash, null); assert.ok(!JSON.stringify(stored).includes(paired.token));
      assert.ok(!("apiKey" in stored)); assert.ok(!("encryptedKey" in stored));
      const expired = await createGateway(owner, "kimi", "kimi-k3", "Expired");
      await db.update(modelGateways).set({ pairingExpiresAt: new Date(0) }).where(eq(modelGateways.id, expired.id));
      assert.equal(await pairGateway(expired.pairingToken), null);
    });
    const metadata = (await listModelKeys(owner)).find((key) => key.id === paired.id)!;
    assert.equal(metadata.custodyMode, "gateway");
    const selection = { billingMode: "own_key" as const, custodyMode: "gateway" as const, credentialId: metadata.id, credentialVersion: metadata.version, provider: metadata.provider, model: metadata.model };
    await assert.rejects(createBuildWithCredit(other, "Build an app", [], selection), /Reconnect/);
    const build = await createBuildWithCredit(owner, "Build an app", [], selection); assert.ok(build);
    await db.update(builds).set({ status: "building" }).where(eq(builds.id, build.buildId));
    const provider = await providerForBuild(owner, build.buildId);
    assert.equal(provider.apiKey, ""); assert.equal(provider.gatewayId, paired.id);
    await t.test("a real bound build round-trips text through the outbound relay", async function relay() {
      const pending = requestAgent(provider, { model: provider.model, messages: [{ role: "user", content: "Build an app" }], max_tokens: 1200 }, newTransportContext(), AbortSignal.timeout(10_000));
      let claim = await claimGatewayRequest(paired.id);
      for (let attempt = 0; !claim && attempt < 20; attempt += 1) { await delay(20); claim = await claimGatewayRequest(paired.id); }
      assert.ok(claim);
      assert.equal(claim.buildId, build.buildId); assert.equal(claim.payload.path, "/responses");
      assert.ok(!JSON.stringify(claim.payload).includes("authorization")); assert.ok(!JSON.stringify(claim.payload).includes("apiKey"));
      const result = { status: 200, body: { id: "resp_mock", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Built through my gateway" }] }], usage: { input_tokens: 19, output_tokens: 7 } } };
      assert.equal(await completeGatewayRequest("wrong-gateway", claim.id, claim.responseToken, result), false);
      assert.equal(await completeGatewayRequest(paired.id, claim.id, "wrong-response-capability", result), false);
      assert.equal(await completeGatewayRequest(paired.id, claim.id, claim.responseToken, result), true);
      assert.equal(await completeGatewayRequest(paired.id, claim.id, claim.responseToken, result), false);
      const reply = await pending; assert.equal(reply.message.content, "Built through my gateway");
      const [stored] = await db.select().from(gatewayRequests).where(eq(gatewayRequests.id, claim.id));
      assert.deepEqual(stored.payload, {}); assert.equal(stored.result, null);
      assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, owner))).length, 0);
    });
    await t.test("cross-account revoke does nothing; owner revoke disables the bound build", async function revoke() {
      await revokeGateway(other, paired.id); assert.ok(await authenticatedGateway(paired.token));
      await revokeGateway(owner, paired.id); assert.equal(await authenticatedGateway(paired.token), null);
      await assert.rejects(providerForBuild(owner, build.buildId), /Reconnect/);
    });
  } finally { if (createdId) await revokeGateway(owner, createdId); await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await close(); }
});
