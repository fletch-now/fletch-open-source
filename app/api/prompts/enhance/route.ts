import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { platformProvider } from "@/lib/agent/provider";
import { streamChat } from "@/lib/agent/chat";
import { ENHANCE_SYSTEM, enhancementResult } from "@/lib/agent/enhance";
import { MAX_PROMPT_CHARS } from "@/lib/build/prompt-limits";
import { checkEnhanceRate, clientIp } from "@/lib/ratelimit";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";
import { logEvent } from "@/lib/log";

const BODY = z.object({ prompt: z.string().trim().min(4).max(MAX_PROMPT_CHARS) }).strict();

export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in", requiresLogin: true }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await readBoundedJson(request, MAX_PROMPT_CHARS * 6 + 1024);
  } catch (cause) {
    if (!(cause instanceof RequestBodyTooLargeError)) throw cause;
    return NextResponse.json({ error: "The prompt exceeds the enhancement limit. Use up to 24,000 characters." }, { status: 413 });
  }
  const parsed = BODY.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Write an app idea or edit request between 4 and 24,000 characters." }, { status: 400 });
  }
  const userId = session.user.id;
  const limit = await checkEnhanceRate(userId, clientIp(request.headers));
  if (!limit.ok) {
    return NextResponse.json({ error: limit.reason }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds ?? 60) } });
  }
  const provider = platformProvider();
  if (!provider) {
    return NextResponse.json({ error: "Prompt enhancement is unavailable right now. Your original prompt is ready to use." }, { status: 503 });
  }
  try {
    const result = await streamChat(
      provider,
      [{ role: "system", content: ENHANCE_SYSTEM }, { role: "user", content: parsed.data.prompt }],
      // Reasoning and the returned brief share the provider's output allowance.
      { maxTokens: 8192, signal: request.signal },
    );
    const response = enhancementResult(result.text, result.finishReason);
    logEvent("enhance", {
      userId,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      finishReason: result.finishReason,
      textChars: result.text.length,
      status: response.status,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch {
    logEvent("enhance", { userId, event: "enhancement_failed", aborted: request.signal.aborted });
    return NextResponse.json({ error: "Enhancement could not finish. Try again or use your original prompt.", code: "enhancement_failed" }, { status: 502 });
  }
}
