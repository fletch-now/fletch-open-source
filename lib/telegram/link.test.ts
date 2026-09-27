import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("Telegram link is single-use and a failed account write rolls the claim back", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function atomicLink() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  const { db, close } = await import("@/lib/db");
  const { user, telegramLinkTokens, telegramAccounts } = await import("@/lib/db/schema");
  const { consumeLinkToken } = await import("@/lib/telegram/link");
  const owner = randomUUID();
  const token = randomUUID();
  try {
    await db.insert(user).values({ id: owner });
    await db.insert(telegramLinkTokens).values({ token, userId: owner, expiresAt: new Date(Date.now() + 60_000) });
    await assert.rejects(consumeLinkToken(token, null as unknown as string, null));
    assert.equal((await db.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, token)))[0].usedAt, null);
    const results = await Promise.all([consumeLinkToken(token, "controlled-chat-a", null), consumeLinkToken(token, "controlled-chat-b", null)]);
    assert.deepEqual(results.sort(), ["expired", "linked"]);
    const accounts = await db.select().from(telegramAccounts).where(eq(telegramAccounts.userId, owner));
    assert.equal(accounts.length, 1);
    assert.ok(["controlled-chat-a", "controlled-chat-b"].includes(accounts[0].chatId));
  } finally {
    await db.delete(user).where(eq(user.id, owner));
    await close();
  }
});
