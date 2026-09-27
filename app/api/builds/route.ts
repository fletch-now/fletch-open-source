import { CreateBuildSchema } from "@/lib/build/create-request";
import { PricingError, replayPricingAcceptance } from "@/lib/build/pricing-quotes";
import { readBoundedJson, RequestBodyTooLargeError } from "@/lib/request-body";
import { MAX_BUILD_BODY_BYTES } from "@/lib/build/attachments";
import { AttachmentError } from "@/lib/build/attachment-images";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { ensureFreeGrantIfEligible } from "@/lib/credits";
import { BuildInFlightError, createBuildWithCredit, createFollowUpBuild } from "@/lib/build/create";
import { ensureBuildRunning } from "@/lib/build/runner";
import { ProjectDeletionError } from "@/lib/projects/delete";
import { BuildSelectionError } from "@/lib/agent/selection";
import { checkIpRate, checkUserRate, clientIp, BuildDailyLimitError } from "@/lib/ratelimit";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";
import { MAX_PROMPT_CHARS } from "@/lib/build/prompt-limits";

const MIN_PROMPT_CHARS = 8;



export async function POST(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in to build" }, { status: 401 });
  }

  let body: unknown;
  try { body = await readBoundedJson(request, MAX_BUILD_BODY_BYTES); }
  catch (error) {
    const status = error instanceof RequestBodyTooLargeError ? 413 : 400;
    return NextResponse.json({ error: "That request is too large or incomplete. Attach fewer files, or send a shorter prompt." }, { status });
  }
  const parsed = CreateBuildSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    let error = "Give a prompt and a valid model selection.";
    if (issue?.path[0] === "prompt") {
      const value = body && typeof body === "object" && "prompt" in body ? body.prompt : null;
      const length = typeof value === "string" ? value.trim().length : 0;
      error = length > MAX_PROMPT_CHARS
        ? `That prompt is ${length.toLocaleString("en-US")} characters; the limit is ${MAX_PROMPT_CHARS.toLocaleString("en-US")}. Attach the longer brief as a text file.`
        : `Describe the app you want (${MIN_PROMPT_CHARS}+ characters).`;
    } else if (issue?.path[0] === "selection") error = "Select a connected provider and model before building.";
    else if (issue?.path[0] === "attachments") error = issue.message;
    else if (issue?.path[0] === "projectId") error = "Choose a saved project or start a new app.";
    return NextResponse.json({ error }, { status: 400 });
  }

  const userId = session.user.id;
  if (parsed.data.approval) {
    try {
      const replay = await db.transaction(tx => replayPricingAcceptance(tx, userId, parsed.data.approval));
      if (replay) return NextResponse.json({ buildId: replay.buildId, slug: replay.slug, projectId: replay.projectId,
        billingMode: replay.billingMode, provider: replay.provider, model: replay.model, capabilities: replay.capabilities });
    } catch (error) {
      if (error instanceof PricingError) return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  }


  const rate = await checkUserRate(userId);
  if (!rate.ok) {
    return NextResponse.json({ error: rate.reason }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } });
  }
  const ipRate = await checkIpRate(clientIp(request.headers));
  if (!ipRate.ok) {
    return NextResponse.json({ error: ipRate.reason }, { status: 429, headers: { "Retry-After": String(ipRate.retryAfterSeconds ?? 60) } });
  }

  // One build at a time per account: a build is minutes of sandbox CPU, and a
  // person cannot read two consoles at once anyway.
  const running = await db
    .select({ value: count() })
    .from(builds)
    .where(and(eq(builds.userId, userId), inArray(builds.status, RUNNING_BUILD_STATUSES)));
  if (!parsed.data.approval && (running[0]?.value ?? 0) > 0) {
    return NextResponse.json({ error: "One build at a time. Wait for the current one to finish." }, { status: 429 });
  }

  // A person on their own model key is billed by their provider, so Fletch
  // takes no credit and does not need to grant one.
  const ownKey = parsed.data.selection.billingMode === "own_key";
  const grant = ownKey ? null : await ensureFreeGrantIfEligible(userId);

  // Atomic: creates the build rows and debits one credit, or returns null if broke.
  let created: Awaited<ReturnType<typeof createBuildWithCredit>>;
  try {
    created = parsed.data.projectId
      ? await createFollowUpBuild(userId, parsed.data.projectId, parsed.data.prompt, parsed.data.attachments ?? [], parsed.data.selection, parsed.data.approval)
      : await createBuildWithCredit(userId, parsed.data.prompt, parsed.data.attachments ?? [], parsed.data.selection, parsed.data.approval);
  } catch (error) {
    if (error instanceof BuildDailyLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof PricingError) return NextResponse.json({ error: error.message, requote: error.status === 409 }, { status: error.status });
    if (error instanceof ProjectDeletionError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof AttachmentError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof BuildSelectionError) {
      return NextResponse.json({ error: error.message, reconnect: true }, { status: 409 });
    }
    if (error instanceof BuildInFlightError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    throw error;
  }
  if (!created) {
    const message =
      grant === "ineligible"
        ? "Free builds are for wallets that have transacted on Robinhood Chain. Use a wallet with some history, or buy credits when packs open."
        : "You're out of build credits";
    return NextResponse.json({ error: message, paywall: true }, { status: 402 });
  }
  // Start it now. Previously only the SSE GET did, so a dropped connection between
  // the two requests stranded a build in 'queued' with its credit already spent.
  // The run detaches from this request, and the stream's own call is a no-op.
  // When every slot is taken the row stays queued and starts as one frees; the
  // stream tells the person their place in line.
  void ensureBuildRunning(created.buildId).catch(function retryFromQueue() {
    // The durable queued row will be retried by the background scheduler.
  });

  return NextResponse.json({
    buildId: created.buildId,
    slug: created.slug,
    projectId: created.projectId,
    billingMode: created.billingMode, provider: created.provider, model: created.model,
    capabilities: created.capabilities,
  });
}

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: builds.id,
      prompt: builds.prompt,
      status: builds.status,
      createdAt: builds.createdAt,
    })
    .from(builds)
    .where(eq(builds.userId, session.user.id))
    .orderBy(desc(builds.createdAt))
    .limit(20);
  return NextResponse.json({ builds: rows });
}
