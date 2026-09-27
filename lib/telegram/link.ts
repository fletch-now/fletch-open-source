// No `server-only`: the watch daemon (workers/watch.ts) does not import this
// module today, but it lives under lib/telegram alongside client.ts, which the
// daemon does — keep the whole directory daemon-safe rather than split by import.
import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { telegramAccounts, telegramBots, telegramLinkTokens, user, watcherDeliveries } from "@/lib/db/schema";
import { telegramBotUsername } from "@/lib/telegram/client";

export const LINK_TOKEN_TTL_SECONDS = 15 * 60;

// 32 url-safe chars of crypto randomness. This token is a bearer credential —
// whoever holds it can link their Telegram chat to the account that requested it —
// so it comes from randomBytes, never Math.random.
function generateToken(): string {
  // base64url encodes 3 bytes -> 4 chars with no padding, so 24 bytes is exactly 32.
  return randomBytes(24).toString("base64url");
}

export interface LinkTokenResult {
  token: string;
  url: string;
}

export async function createLinkToken(userId: string, bot?: { botId: string; username: string }): Promise<LinkTokenResult> {
  const token = bot ? `bot_${bot.botId}_${generateToken()}` : generateToken();
  await db.insert(telegramLinkTokens).values({
    token,
    userId,
    expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_SECONDS * 1000),
  });
  return { token, url: `https://t.me/${bot?.username ?? telegramBotUsername()}?start=${token}` };
}

export type ConsumeResult = "linked" | "expired" | "unknown";

// Single-use by construction: the UPDATE only matches a token that is still
// unused and unexpired, so a retried webhook delivery (Telegram retries on a slow
// ack) can never link a second time off the same token.
export async function consumeLinkToken(token: string, chatId: string, username: string | null, context?: { userId: string; botId: string }): Promise<ConsumeResult> {
  return db.transaction(async function link(tx): Promise<ConsumeResult> {
    const [linkToken] = await tx.select().from(telegramLinkTokens).where(eq(telegramLinkTokens.token, token)).limit(1);
    if (!linkToken || (context && linkToken.userId !== context.userId)) return "unknown";
    // Serialize bot changes and chat linking for this account.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, linkToken.userId)).for("update");
    const [bot] = await tx.select({ botId: telegramBots.botId }).from(telegramBots).where(eq(telegramBots.userId, linkToken.userId));
    if (context) {
      if (bot?.botId !== context.botId || !token.startsWith(`bot_${context.botId}_`)) return "unknown";
    } else if (bot || token.startsWith("bot_")) {
      return "unknown";
    }
    const claimed = await tx
      .update(telegramLinkTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(telegramLinkTokens.token, token),
          isNull(telegramLinkTokens.usedAt),
          gt(telegramLinkTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ userId: telegramLinkTokens.userId });

    if (claimed.length === 0) {
      const rows = await tx
        .select({ token: telegramLinkTokens.token })
        .from(telegramLinkTokens)
        .where(eq(telegramLinkTokens.token, token))
        .limit(1);
      // A row that exists but didn't match the UPDATE's conditions is used or expired;
      // either way there's nothing more specific to tell the sender.
      return rows[0] ? "expired" : "unknown";
    }

    const userId = claimed[0].userId;
    await tx
      .insert(telegramAccounts)
      .values({ userId, chatId, username, linkedAt: sql`now()` })
      .onConflictDoUpdate({
        target: telegramAccounts.userId,
        set: { chatId, username, linkedAt: sql`now()` },
      });
    await releaseHeldDeliveries(userId, tx);

    return "linked";
  });
}

export async function getTelegramAccount(userId: string): Promise<{ chatId: string; username: string | null; linkedAt: Date } | null> {
  const rows = await db
    .select({ chatId: telegramAccounts.chatId, username: telegramAccounts.username, linkedAt: telegramAccounts.linkedAt })
    .from(telegramAccounts)
    .where(eq(telegramAccounts.userId, userId))
    .limit(1);
  return rows[0] ?? null;
}

export async function unlinkTelegram(userId: string): Promise<void> {
  await db.delete(telegramAccounts).where(eq(telegramAccounts.userId, userId));
}

// Alerts detected while Telegram was not linked were held, not lost. Linking
// puts the last day's worth back in the queue; older ones stay on the page as
// held, since a day-old transfer alert is history rather than news.
export async function releaseHeldDeliveries(userId: string, executor: Pick<typeof db, "update"> = db): Promise<number> {
  const released = await executor
    .update(watcherDeliveries)
    .set({ status: "pending", attempts: 0, nextAttemptAt: sql`now()`, lastError: null })
    .where(and(eq(watcherDeliveries.userId, userId), eq(watcherDeliveries.status, "held"), gt(watcherDeliveries.createdAt, sql`now() - interval '24 hours'`)))
    .returning({ id: watcherDeliveries.id });
  return released.length;
}
