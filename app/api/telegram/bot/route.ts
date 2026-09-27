import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { recordAudit } from "@/lib/audit";
import { removeUserBot, saveUserBot } from "@/lib/telegram/bots";
import { logEvent } from "@/lib/log";

const Body = z.object({ token: z.string().trim().min(20).max(120) });

// Save a person's own bot token. The token is validated with Telegram, stored
// encrypted, and never echoed back; the response carries only the bot's name.
export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const parsed = Body.safeParse(await request.json().catch(function ignore() { return null; }));
  if (!parsed.success) {
    return NextResponse.json({ error: "Paste the token BotFather gave you." }, { status: 400 });
  }
  const result = await saveUserBot(session.user.id, parsed.data.token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await recordAudit({ userId: session.user.id, actorType: "user", action: "telegram.bot.save", metadata: { botId: result.bot.botId } });
  logEvent("telegram", { action: "bot_saved", userId: session.user.id, botId: result.bot.botId });
  return NextResponse.json({ bot: result.bot });
}

export async function DELETE(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  await removeUserBot(session.user.id);
  await recordAudit({ userId: session.user.id, actorType: "user", action: "telegram.bot.remove" });
  return NextResponse.json({ ok: true });
}
