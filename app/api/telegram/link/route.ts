import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { telegramConfigured } from "@/lib/telegram/client";
import { createLinkToken, LINK_TOKEN_TTL_SECONDS, unlinkTelegram } from "@/lib/telegram/link";
import { getUserBot } from "@/lib/telegram/bots";
import { logEvent } from "@/lib/log";

export async function POST(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  if (!telegramConfigured()) {
    return NextResponse.json({ error: "Telegram is not configured yet" }, { status: 503 });
  }

  if (await getUserBot(session.user.id)) {
    return NextResponse.json({ error: "Remove your custom bot before connecting the Fletch bot." }, { status: 409 });
  }
  const { url } = await createLinkToken(session.user.id);
  logEvent("telegram", { action: "link_token_created", userId: session.user.id });
  return NextResponse.json({ url, expiresInSeconds: LINK_TOKEN_TTL_SECONDS }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }

  await unlinkTelegram(session.user.id);
  await recordAudit({ userId: session.user.id, actorType: "user", action: "telegram.unlink" });
  logEvent("telegram", { action: "unlinked", userId: session.user.id });
  return NextResponse.json({ ok: true });
}
