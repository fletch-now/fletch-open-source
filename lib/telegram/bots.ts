// A person's own Telegram bot. No "server-only": lib/watch/deliver.ts, which the
// daemon imports, reads the token from here at send time.
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { telegramAccounts, telegramBots, telegramLinkTokens, user } from "@/lib/db/schema";
import { getBotIdentity, recentPrivateChats } from "@/lib/telegram/client";
import { consumeLinkToken, createLinkToken, type LinkTokenResult } from "@/lib/telegram/link";
import { decryptSecret, encryptSecret } from "@/lib/telegram/secret";

// BotFather tokens look like "123456789:AAH...": a numeric bot id, a colon, and
// 35 or so characters. The check is a shape check; getMe is the real one.
const TOKEN_SHAPE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

export interface UserBot {
  botId: string;
  username: string;
  createdAt: Date;
  lastCheckedAt: Date | null;
}

export type SaveBotResult = { ok: true; bot: UserBot } | { ok: false; error: string };

export async function saveUserBot(userId: string, rawToken: string): Promise<SaveBotResult> {
  const token = rawToken.trim();
  if (!TOKEN_SHAPE.test(token)) {
    return { ok: false, error: "That does not look like a bot token. BotFather sends one like 123456789:AAH…" };
  }
  const identity = await getBotIdentity(token);
  if (!identity) {
    return { ok: false, error: "Telegram did not accept that token. Copy it again from BotFather." };
  }
  const rows = await db.transaction(async function save(tx) {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    const [previous] = await tx.select({ botId: telegramBots.botId }).from(telegramBots).where(eq(telegramBots.userId, userId));
    if (previous?.botId !== identity.id) {
      await tx.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
      await tx.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId));
    }
    return tx.insert(telegramBots)
    .values({ userId, tokenEnc: encryptSecret(token), botId: identity.id, botUsername: identity.username })
    .onConflictDoUpdate({
      target: telegramBots.userId,
      set: { tokenEnc: encryptSecret(token), botId: identity.id, botUsername: identity.username, createdAt: sql`now()`, lastCheckedAt: null },
    })
    .returning({ botId: telegramBots.botId, username: telegramBots.botUsername, createdAt: telegramBots.createdAt, lastCheckedAt: telegramBots.lastCheckedAt });
  });
  return { ok: true, bot: rows[0] };
}

export async function getUserBot(userId: string): Promise<UserBot | null> {
  const rows = await db
    .select({ botId: telegramBots.botId, username: telegramBots.botUsername, createdAt: telegramBots.createdAt, lastCheckedAt: telegramBots.lastCheckedAt })
    .from(telegramBots)
    .where(eq(telegramBots.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

// Decrypted only here, for one send. Never returned to a page or a log.
export async function getUserBotToken(userId: string): Promise<string | null> {
  const rows = await db.select({ tokenEnc: telegramBots.tokenEnc }).from(telegramBots).where(eq(telegramBots.userId, userId)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  try {
    return decryptSecret(row.tokenEnc);
  } catch {
    return null;
  }
}

// Removing the bot also unlinks the chat: the chat id was learned through this
// bot and the platform bot cannot message it.
export async function removeUserBot(userId: string): Promise<void> {
  await db.transaction(async function remove(tx): Promise<void> {
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for("update");
    await tx.delete(telegramBots).where(eq(telegramBots.userId, userId));
    await tx.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
    await tx.delete(telegramLinkTokens).where(eq(telegramLinkTokens.userId, userId));
  });
}

export type LinkChatResult = { ok: true; username: string | null } | { ok: false; error: string };

export async function prepareUserBotLink(userId: string): Promise<LinkTokenResult | null> {
  const bot = await getUserBot(userId);
  if (!bot) return null;
  return createLinkToken(userId, bot);
}

// Match only the private Start message carrying this account's expiring challenge.
export async function linkChatFromUserBot(userId: string, challenge: string): Promise<LinkChatResult> {
  const bot = await getUserBot(userId);
  const token = await getUserBotToken(userId);
  if (!bot || !token) return { ok: false, error: "Add your bot token first." };
  const [link] = await db.select({ token: telegramLinkTokens.token }).from(telegramLinkTokens).where(and(
    eq(telegramLinkTokens.token, challenge), eq(telegramLinkTokens.userId, userId),
    isNull(telegramLinkTokens.usedAt), gt(telegramLinkTokens.expiresAt, sql`now()`),
  ));
  if (!link || !challenge.startsWith(`bot_${bot.botId}_`)) {
    return { ok: false, error: "This private link has expired or was already used. Create a new link." };
  }
  let chats;
  try {
    chats = await recentPrivateChats(token);
  } catch {
    return { ok: false, error: "Could not read this bot's messages. Use a dedicated bot without another webhook or polling connection, then try again." };
  }
  const match = chats.find(function matches(chat): boolean {
    return chat.text === `/start ${challenge}` || chat.text === `/start@${bot.username} ${challenge}`;
  });
  await db.update(telegramBots).set({ lastCheckedAt: sql`now()` }).where(eq(telegramBots.userId, userId));
  if (!match) return { ok: false, error: "Open your private link and press Start in Telegram, then finish linking here." };
  const result = await consumeLinkToken(challenge, match.chatId, match.username, { userId, botId: bot.botId });
  if (result !== "linked") return { ok: false, error: "This link is no longer valid. Create a new private link." };
  return { ok: true, username: match.username };
}
