import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { linkChatFromUserBot, prepareUserBotLink } from "@/lib/telegram/bots";
import { logEvent } from "@/lib/log";

import { LINK_TOKEN_TTL_SECONDS } from "@/lib/telegram/link";
export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const body = await request.json().catch(function invalid() { return null; });
  if (body?.action === "prepare") {
    const link = await prepareUserBotLink(session.user.id);
    if (!link) return NextResponse.json({ error: "Add your bot token first." }, { status: 409 });
    return NextResponse.json({ ...link, expiresInSeconds: LINK_TOKEN_TTL_SECONDS }, { headers: { "Cache-Control": "no-store" } });
  }
  if (typeof body?.token !== "string" || !/^bot_\d{5,15}_[A-Za-z0-9_-]{32}$/.test(body.token)) {
    return NextResponse.json({ error: "Create a private link before connecting this chat." }, { status: 400 });
  }
  const result = await linkChatFromUserBot(session.user.id, body.token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  await recordAudit({ userId: session.user.id, actorType: "user", action: "telegram.link", metadata: { via: "own-bot" } });
  logEvent("telegram", { action: "linked_via_own_bot", userId: session.user.id });
  return NextResponse.json({ username: result.username });
}
