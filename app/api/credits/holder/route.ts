import { NextResponse } from "next/server";
import { APP_URL } from "@/lib/config";
import { getSession } from "@/lib/dal";
import { getBalance } from "@/lib/credits";
import { checkSessionApiRate } from "@/lib/ratelimit";
import { checkHolderReward } from "@/lib/holder-rewards/store";
import { readBoundedJson } from "@/lib/request-body";

export const runtime = "nodejs";

function response(body: unknown, status = 200): Response {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex" } });
}

// The wallet, token, price and credit amount never come from the browser.
export async function POST(request: Request): Promise<Response> {
  if (request.headers.get("origin") !== new URL(APP_URL).origin || request.headers.get("sec-fetch-site") === "cross-site") return response({ error: "Open Fletch to check holder credits." }, 403);
  try { await readBoundedJson(request, 0, { allowEmpty: true }); }
  catch { return response({ error: "This check does not accept request data." }, 400); }
  const session = await getSession();
  if (!session) return response({ error: "Sign in to check holder credits." }, 401);
  const rate = await checkSessionApiRate(session.user.id);
  if (!rate.ok) return response({ error: "Too many checks. Retry shortly." }, 429);
  try {
    const result = await checkHolderReward(session.user.id);
    const balance = await getBalance(session.user.id).catch(() => undefined);
    return response({ ...result, balance });
  } catch {
    return response({ error: "Holder-credit status could not be confirmed. Retry shortly; repeated checks cannot award duplicate credits." }, 503);
  }
}
