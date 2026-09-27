import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/dal";
import { readBoundedJson } from "@/lib/request-body";
import { issueExtensionQuote, acceptExtensionQuote, readOwnerBuildBudget } from "@/lib/build/pricing-extensions";
import { PricingError } from "@/lib/build/pricing-quotes";

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("quote") }).strict(),
  z.object({ action: z.literal("accept"), approval: z.object({ quoteId: z.string().uuid(), digest: z.string().regex(/^[a-f0-9]{64}$/), requestId: z.string().uuid() }).strict() }).strict(),
]);
function failure(error: unknown): Response {
  if (error instanceof PricingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Build allowance request failed", error);
  return NextResponse.json({ error: "This build cannot accept an allowance right now. Your progress is saved." }, { status: 409 });
}
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  try { return NextResponse.json(await readOwnerBuildBudget(session.user.id, (await context.params).id)); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  let body: z.infer<typeof RequestSchema>;
  try { body = RequestSchema.parse(await readBoundedJson(request, 2048)); }
  catch { return NextResponse.json({ error: "Invalid allowance request." }, { status: 400 }); }
  const { id } = await context.params;
  try {
    if (body.action === "quote") return NextResponse.json(await issueExtensionQuote(session.user.id, id));
    return NextResponse.json(await acceptExtensionQuote(session.user.id, id, body.approval));
  } catch (error) { return failure(error); }
}
