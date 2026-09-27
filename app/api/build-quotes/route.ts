import { db } from "@/lib/db";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/dal";
import { readBoundedJson } from "@/lib/request-body";
import { MAX_BUILD_BODY_BYTES } from "@/lib/build/attachments";
import { CreateBuildSchema } from "@/lib/build/create-request";
import { PricingTier } from "@/lib/build/pricing-policy";
import { issueBuildQuote, activePricing, PricingError } from "@/lib/build/pricing-quotes";
import { AttachmentError } from "@/lib/build/attachment-images";
import { BuildSelectionError } from "@/lib/agent/selection";

const QuoteRequest = CreateBuildSchema.omit({ approval: true }).extend({ tier: PricingTier.default("small") });

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to review a build." }, { status: 401 });
  let input;
  try { input = QuoteRequest.parse(await readBoundedJson(request, MAX_BUILD_BODY_BYTES)); }
  catch { return NextResponse.json({ error: "Give a valid draft and package selection." }, { status: 400 }); }
  try { return NextResponse.json(await issueBuildQuote(session.user.id, input)); }
  catch (error) {
    if (error instanceof PricingError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AttachmentError || error instanceof BuildSelectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to review a build." }, { status: 401 });
  try {
    const published = await db.transaction(activePricing);
    return NextResponse.json({ published: published !== null });
  } catch (error) {
    if (error instanceof PricingError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
