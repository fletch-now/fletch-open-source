import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
test("CLI session reuse requires an identical Kimi execution selection", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function sessions() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, builds, projects } = await import("@/lib/db/schema");
  const { priorSessionId } = await import("@/lib/agent/session");
  const owner = randomUUID(), projectId = randomUUID();
  const baseline = { userId: owner, projectId, prompt: "Edit this app", billingMode: "own_key" as const, custodyMode: "hosted" as const, provider: "kimi" as const, model: "kimi-k3", credentialId: "mk-version-bound", credentialVersion: 1 };
  try {
    await db.insert(user).values({ id: owner });
    await db.insert(projects).values({ id: projectId, userId: owner, slug: `session-${randomUUID()}`, name: "Session test" });
    await db.insert(builds).values({ ...baseline, id: randomUUID(), status: "succeeded", agentSessionId: "matching-kimi-session", createdAt: new Date("2020-01-01"), startedAt: new Date("2020-01-01") });
    const unchanged = randomUUID();
    await db.insert(builds).values({ ...baseline, id: unchanged });
    assert.equal(await priorSessionId(projectId, unchanged), "matching-kimi-session");
    const variants: Array<Partial<typeof builds.$inferInsert>> = [
      { provider: "openai" }, { provider: "anthropic" }, { model: "other-model" },
      { custodyMode: "gateway" }, { credentialId: "another-key" }, { credentialVersion: 2 },
      { billingMode: "platform", custodyMode: "platform", credentialId: null, credentialVersion: null },
    ];
    for (const variant of variants) {
      const id = randomUUID();
      await db.insert(builds).values({ ...baseline, ...variant, id });
      assert.equal(await priorSessionId(projectId, id), undefined, JSON.stringify(variant));
    }
    await db.insert(builds).values({ ...baseline, id: randomUUID(), status: "succeeded", agentSessionId: "future-session", createdAt: new Date("2099-01-01"), startedAt: new Date("2099-01-01") });
    assert.equal(await priorSessionId(projectId, unchanged), "matching-kimi-session", "Future sessions cannot enter earlier requests");
    await db.insert(builds).values({ ...baseline, id: randomUUID(), status: "failed", agentSessionId: "incomplete-session", createdAt: new Date("2020-01-02"), startedAt: new Date("2020-01-02") });
    assert.equal(await priorSessionId(projectId, unchanged), undefined, "A failed latest turn uses the saved conversation, not an older native session");
  } finally { await db.delete(user).where(eq(user.id, owner)); await close(); }
});
