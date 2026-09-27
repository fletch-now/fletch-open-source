// Telegram delivers every bot update here. Register this URL once per environment
// with lib/telegram/client.ts's setWebhook, e.g. from a one-off script, or directly:
//
//   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
//     -d "url=https://<host>/api/webhooks/telegram" \
//     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET"
//
// Telegram echoes secret_token back on every update as the
// X-Telegram-Bot-Api-Secret-Token header, which is what this route checks.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { consumeLinkToken } from "@/lib/telegram/link";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { logEvent } from "@/lib/log";
import { recordAudit } from "@/lib/audit";
import { db } from "@/lib/db";
import { telegramAccounts } from "@/lib/db/schema";

const TelegramUpdateSchema = z.object({
  message: z
    .object({
      text: z.string().optional(),
      chat: z.object({ id: z.number(), type: z.string() }),
      from: z.object({ username: z.string().optional() }).optional(),
    })
    .optional(),
});

const START_COMMAND = /^\/start\s+([A-Za-z0-9_-]{32})\s*$/;

function replyFor(result: "linked" | "expired" | "unknown"): string {
  if (result === "linked") {
    return "Linked. Fletch will message you here.";
  }
  if (result === "expired") {
    return "That link expired or was already used. Generate a new one from Fletch and try again.";
  }
  return "That link isn't recognized. Generate a new one from Fletch and try again.";
}

export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(function invalidJson(): null {
    return null;
  });
  const parsed = TelegramUpdateSchema.safeParse(body);
  // Telegram requires 200 on every delivery or it retries the same update forever;
  // an update this route doesn't handle is not an error, just a no-op.
  if (!parsed.success || !parsed.data.message?.text) {
    return NextResponse.json({ ok: true });
  }

  const { message } = parsed.data;
  if (message.chat.type !== "private") {
    return NextResponse.json({ ok: true });
  }
  if (/^\/(start|help)(?:@fletch_now_bot)?\s*$/.test(message.text ?? "")) {
    const sent = await sendTelegramMessage(String(message.chat.id),
      "Fletch watches Robinhood Chain and sends the alerts you choose.\n\nTo link your account, open https://fletch.now/dashboard/settings and choose Link Telegram. Then return here using that link. Manage your watchers at https://fletch.now/dashboard/watch.");
    if (!sent.ok) {
      logEvent("telegram", { action: "help_reply_failed", error: sent.error });
    }
    return NextResponse.json({ ok: true });
  }
  const match = START_COMMAND.exec(message.text ?? "");
  if (!match) {
    return NextResponse.json({ ok: true });
  }

  const token = match[1];
  const chatId = String(message.chat.id);
  const username = message.from?.username ?? null;
  const result = await consumeLinkToken(token, chatId, username);

  logEvent("telegram", { action: "link_attempt", result });
  if (result === "linked") {
    // consumeLinkToken already upserted this chat's account row, so its userId
    // is a lookup by chatId rather than a value consumeLinkToken hands back.
    const linked = await db
      .select({ userId: telegramAccounts.userId })
      .from(telegramAccounts)
      .where(eq(telegramAccounts.chatId, chatId))
      .limit(1);
    if (linked[0]) {
      await recordAudit({ userId: linked[0].userId, actorType: "user", action: "telegram.link" });
    }
  }

  const sent = await sendTelegramMessage(chatId, replyFor(result));
  if (!sent.ok) {
    logEvent("telegram", { action: "link_reply_failed", error: sent.error });
  }

  return NextResponse.json({ ok: true });
}
