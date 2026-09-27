import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";

test("custom bot linking requires the owner's live challenge, releases recent matches and survives bot changes", { skip: !process.env.FLETCH_TEST_DATABASE_URL }, async function privateLink() {
  process.env.DATABASE_URL = process.env.FLETCH_TEST_DATABASE_URL;
  process.env.TELEGRAM_TOKEN_KEY = "controlled-test-encryption-key";
  const { db, close } = await import("@/lib/db");
  const { user, watchers, watcherDeliveries, telegramAccounts, telegramLinkTokens } = await import("@/lib/db/schema");
  const { saveUserBot, prepareUserBotLink, linkChatFromUserBot, removeUserBot } = await import("@/lib/telegram/bots");
  const { consumeLinkToken } = await import("@/lib/telegram/link");
  const { getWatcherForUser, listDeliveriesForWatcher, listDeliveriesForUser } = await import("@/lib/watch/queries");
  const owner = randomUUID();
  const stranger = randomUUID();
  const watcherId = randomUUID();
  const recentId = randomUUID();
  const olderId = randomUUID();
  const originalFetch = globalThis.fetch;
  let botId = "123456789";
  let updates: { message: { date: number; text: string; chat: { id: number; type: string; username?: string } } }[] = [];
  const methods: string[] = [];
  globalThis.fetch = async function telegramFixture(input): Promise<Response> {
    const method = new URL(String(input)).pathname.split("/").at(-1)!;
    methods.push(method);
    if (method === "getMe") return Response.json({ ok: true, result: { id: Number(botId), username: "controlled_bot" } });
    if (method === "getUpdates") return Response.json({ ok: true, result: updates });
    throw new Error("Fixture forbids Telegram messages and webhook changes");
  };
  function message(chatId: number, text: string, date = 1): typeof updates[number] {
    return { message: { date, text, chat: { id: chatId, type: "private" } } };
  }
  try {
    await db.insert(user).values([{ id: owner }, { id: stranger }]);
    await db.insert(watchers).values({ id: watcherId, userId: owner, name: "Dashboard match fixture", kind: "large_transfer", chainId: 777338, address: `0x${"7".repeat(40)}`, threshold: "1" });
    const now = new Date();
    const delivery = { watcherId, userId: owner, blockNumber: BigInt(1), blockHash: "controlled-block", status: "held" as const, payload: { kind: "large_transfer", amount: "5", symbol: "TEST", from: "source", to: "target" } };
    await db.insert(watcherDeliveries).values([
      { ...delivery, id: recentId, txHash: "recent-match", logIndex: 0, createdAt: now },
      { ...delivery, id: olderId, txHash: "older-match", logIndex: 1, createdAt: new Date(Date.now() - 48 * 3_600_000) },
    ]);
    const watcher = await getWatcherForUser(owner, watcherId);
    assert.equal(watcher?.lastDelivery?.status, "held");
    assert.equal(watcher.lastDelivery.sentAt, null);
    assert.ok(Math.abs(watcher.lastDelivery.createdAt.getTime() - now.getTime()) < 1000);
    assert.equal(await getWatcherForUser(stranger, watcherId), null);
    assert.equal((await listDeliveriesForWatcher(stranger, watcherId, 100)).length, 0);
    assert.equal((await listDeliveriesForUser(owner, 100)).length, 2);
    assert.equal((await saveUserBot(owner, `${botId}:${"A".repeat(35)}`)).ok, true);
    const challenge = await prepareUserBotLink(owner);
    assert.ok(challenge);
    assert.ok(challenge.token.length <= 64);
    updates = [message(999, "/start", 100)];
    assert.equal((await linkChatFromUserBot(owner, challenge.token)).ok, false, "An unrelated newest chat cannot link");
    updates.push(message(111, `/start ${challenge.token}`, 10));
    assert.equal((await linkChatFromUserBot(stranger, challenge.token)).ok, false);
    assert.equal(await consumeLinkToken(challenge.token, "999", null), "unknown", "Shared webhook cannot consume custom-bot challenges");
    assert.equal(await consumeLinkToken(challenge.token, "999", null, { userId: owner, botId: "987654321" }), "unknown");
    const attempts = await Promise.all([linkChatFromUserBot(owner, challenge.token), linkChatFromUserBot(owner, challenge.token)]);
    assert.equal(attempts.filter(function linked(result) { return result.ok; }).length, 1);
    const [account] = await db.select().from(telegramAccounts).where(eq(telegramAccounts.userId, owner));
    assert.equal(account.chatId, "111");
    assert.equal(account.username, null, "A Telegram username is optional");
    assert.equal((await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.id, recentId)))[0].status, "pending");
    assert.equal((await db.select().from(watcherDeliveries).where(eq(watcherDeliveries.id, olderId)))[0].status, "held");
    const expired = await prepareUserBotLink(owner);
    assert.ok(expired);
    await db.update(telegramLinkTokens).set({ expiresAt: new Date(0) }).where(eq(telegramLinkTokens.token, expired.token));
    updates = [message(999, `/start ${expired.token}`)];
    assert.equal((await linkChatFromUserBot(owner, expired.token)).ok, false);
    await saveUserBot(owner, `${botId}:${"B".repeat(35)}`);
    assert.equal((await db.select().from(telegramAccounts).where(eq(telegramAccounts.userId, owner))).length, 1, "Same-bot token rotation retains chat");
    const previous = await prepareUserBotLink(owner);
    assert.ok(previous);
    botId = "987654321";
    await saveUserBot(owner, `${botId}:${"C".repeat(35)}`);
    assert.equal((await db.select().from(telegramAccounts).where(eq(telegramAccounts.userId, owner))).length, 0, "Different bot requires new chat consent");
    assert.equal((await linkChatFromUserBot(owner, previous.token)).ok, false);
    await removeUserBot(owner);
    assert.equal(await prepareUserBotLink(owner), null);
    assert.ok(methods.every(function readOnly(method) { return method === "getMe" || method === "getUpdates"; }));
  } finally {
    globalThis.fetch = originalFetch;
    await db.delete(user).where(eq(user.id, owner));
    await db.delete(user).where(eq(user.id, stranger));
    await close();
  }
});
