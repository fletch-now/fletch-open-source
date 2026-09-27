import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import "@/lib/test-server-only";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { encryptCredential, decryptCredential } from "@/lib/agent/credential-secret";

// Next resolves this marker at bundle time; these server modules also need real DB tests.

test("credential encryption binds ciphertext to owner, provider and version", function encryption() {
  process.env.MODEL_CREDENTIAL_KEY = randomBytes(32).toString("hex");
  const ciphertext = encryptCredential("test-provider-secret", "owner/openai/credential/1");
  assert.equal(decryptCredential(ciphertext, "owner/openai/credential/1"), "test-provider-secret");
  assert.throws(() => decryptCredential(ciphertext, "other/openai/credential/1"));
  assert.throws(() => decryptCredential(ciphertext, "owner/anthropic/credential/1"));
  assert.throws(() => decryptCredential(ciphertext, "owner/openai/credential/2"));
  assert.ok(!ciphertext.includes("test-provider-secret"));
});
test("queued own-key builds bind billing, owner, provider and credential version", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function queued(t) {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  process.env.MODEL_CREDENTIAL_KEY = randomBytes(32).toString("hex");
  delete process.env.MOONSHOT_API_KEY;
  const { db, close } = await import("@/lib/db");
  const { user, builds, creditEvents, appSettings } = await import("@/lib/db/schema");
  const { saveModelKey, deleteModelKey, listModelKeys, providerForBuild } = await import("@/lib/agent/user-keys");
  const { createBuildWithCredit, createFollowUpBuild } = await import("@/lib/build/create");
  const { refundBuild } = await import("@/lib/credits");
  const owner = randomUUID(), other = randomUUID();
  try {
    await db.insert(user).values([{ id: owner }, { id: other }]);
    await saveModelKey(owner, "openai", "test-openai-key-original", "gpt-5.2");
    await saveModelKey(owner, "anthropic", "test-anthropic-key-original", "claude-sonnet-4-5");
    const keys = await listModelKeys(owner);
    const key = keys.find((key) => key.provider === "anthropic")!;
    const selection = { billingMode: "own_key" as const, credentialId: key.id, credentialVersion: key.version, provider: key.provider, model: key.model };
    let build: NonNullable<Awaited<ReturnType<typeof createBuildWithCredit>>>;
    await t.test("zero credits and missing platform key still queue the explicitly selected provider", async function own() {
      const created = await createBuildWithCredit(owner, "Create a simple app", [], selection);
      assert.ok(created); build = created;
      assert.equal(created.billingMode, "own_key"); assert.equal(created.provider, "anthropic");
      const actual = await providerForBuild(owner, created.buildId);
      assert.equal(actual.apiKey, "test-anthropic-key-original");
      assert.equal(actual.credentialVersion, key.version);
      assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, owner))).length, 0);
    });
    await t.test("a persisted build selection cannot be edited after queueing", async function immutable() {
      await assert.rejects(db.update(builds).set({ model: "different-model" }).where(eq(builds.id, build.buildId)));
      await assert.rejects(db.update(builds).set({ billingMode: "platform" }).where(eq(builds.id, build.buildId)));
      await assert.rejects(db.update(builds).set({ credentialVersion: key.version + 1 }).where(eq(builds.id, build.buildId)));
    });
    await t.test("an operator-paused integration refuses bound execution and new selections", async function paused() {
      const settingKey = "build.provider.anthropic.enabled";
      const [previous] = await db.select().from(appSettings).where(eq(appSettings.key, settingKey));
      try {
        await db.insert(appSettings).values({ key: settingKey, value: "0" }).onConflictDoUpdate({ target: appSettings.key, set: { value: "0" } });
        await assert.rejects(providerForBuild(owner, build.buildId), /paused/);
        await assert.rejects(createBuildWithCredit(other, "Create another app", [], selection), /paused/);
      } finally {
        if (previous) await db.update(appSettings).set({ value: previous.value }).where(eq(appSettings.key, settingKey));
        else await db.delete(appSettings).where(eq(appSettings.key, settingKey));
      }
    });
    await t.test("another account cannot queue or resolve the credential", async function ownership() {
      await assert.rejects(createBuildWithCredit(other, "Create a simple app", [], selection), /Reconnect/);
      await assert.rejects(providerForBuild(other, build.buildId));
    });
    await t.test("simultaneous builds cannot bypass the infrastructure limit", async function concurrent() {
      await assert.rejects(createBuildWithCredit(owner, "Create a second app", [], selection), /One build at a time/);
    });
    await t.test("rotation invalidates the bound version without changing the payer or falling back", async function rotate() {
      await saveModelKey(owner, "anthropic", "test-anthropic-key-rotated", "claude-sonnet-4-5");
      await assert.rejects(providerForBuild(owner, build.buildId), /Reconnect/);
      const [persisted] = await db.select().from(builds).where(eq(builds.id, build.buildId));
      assert.equal(persisted.credentialVersion, key.version); assert.equal(persisted.billingMode, "own_key");
      await refundBuild(owner, build.buildId);
      assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, owner))).length, 0);
      await db.update(builds).set({ status: "failed" }).where(eq(builds.id, build.buildId));
      await assert.rejects(createFollowUpBuild(owner, build.projectId, "Change the title", [], selection), /Reconnect/);
    });
    await t.test("revocation stops new and queued builds and no refund is minted", async function revoke() {
      const replacement = (await listModelKeys(owner)).find((key) => key.provider === "anthropic")!;
      const updated = { ...selection, credentialVersion: replacement.version };
      const followup = await createFollowUpBuild(owner, build.projectId, "Change the title", [], updated);
      assert.ok(followup);
      await deleteModelKey(owner, "anthropic");
      await deleteModelKey(owner, "anthropic");
      await assert.rejects(providerForBuild(owner, followup.buildId), /Reconnect/);
      await refundBuild(owner, followup.buildId);
      assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, owner))).length, 0);
    });
    await t.test("image capability is bound before queueing and unsupported images create no debit", async function imageBilling() {
      const imageOwner = randomUUID();
      const image = { kind: "image" as const, name: "reference.png", mediaType: "image/png" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC" };
      await db.insert(user).values({ id: imageOwner });
      try {
        await saveModelKey(imageOwner, "openai", "test-openai-image-key", "unknown-text-model");
        const [textKey] = await listModelKeys(imageOwner);
        const textSelection = { billingMode: "own_key" as const, credentialId: textKey.id, credentialVersion: textKey.version, provider: textKey.provider, model: textKey.model };
        await assert.rejects(createBuildWithCredit(imageOwner, "Build from this visual", [image], textSelection), /does not support image/);
        assert.equal((await db.select().from(builds).where(eq(builds.userId, imageOwner))).length, 0);
        assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, imageOwner))).length, 0);
        await saveModelKey(imageOwner, "openai", "test-openai-image-key", "gpt-5.2");
        const [visionKey] = await listModelKeys(imageOwner);
        assert.equal(visionKey.capabilities.images, true);
        const created = await createBuildWithCredit(imageOwner, "Build from this visual", [image], { ...textSelection, credentialVersion: visionKey.version, model: visionKey.model });
        assert.ok(created);
        const provider = await providerForBuild(imageOwner, created.buildId);
        assert.deepEqual(provider.referenceImages, [image]);
        assert.equal(provider.capabilities?.images, true);
        await assert.rejects(db.update(builds).set({ capabilities: { text: true, tools: true, images: false } }).where(eq(builds.id, created.buildId)));
        await refundBuild(imageOwner, created.buildId);
        assert.equal((await db.select().from(creditEvents).where(eq(creditEvents.userId, imageOwner))).length, 0);
      } finally { await db.delete(user).where(eq(user.id, imageOwner)); }
    });
    await t.test("metadata has no key material and an omitted selection never chooses the first saved key", async function metadata() {
      const publicKeys = await listModelKeys(owner);
      assert.ok(!JSON.stringify(publicKeys).includes("test-openai-key"));
      assert.ok(!("encryptedKey" in publicKeys[0]));
      await assert.rejects(createBuildWithCredit(other, "Create a platform app"), /Fletch's model is unavailable/);
    });
  } finally { await db.delete(user).where(eq(user.id, owner)); await db.delete(user).where(eq(user.id, other)); await close(); }
});
