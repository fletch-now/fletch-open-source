import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { platformProvider } from "@/lib/agent/provider";
import { isProviderId, validModel } from "@/lib/agent/selection";
import { recentBuildDuration } from "@/lib/build/duration-history";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in" }, { status: 401, headers });
  const params = new URL(request.url).searchParams;
  const buildId = params.get("buildId");
  let provider = params.get("provider");
  let model = params.get("model");
  let startedAt: Date | null = null;
  let needsContract: boolean | null = null;
  if (buildId) {
    if (buildId.length > 100) return NextResponse.json({ error: "Invalid build" }, { status: 400, headers });
    const [build] = await db.select({ provider: builds.provider, model: builds.model, startedAt: builds.startedAt, needsContract: builds.needsContract })
      .from(builds).where(and(eq(builds.id, buildId), eq(builds.userId, session.user.id))).limit(1);
    if (!build) return NextResponse.json({ error: "Not found" }, { status: 404, headers });
    ({ provider, model, startedAt, needsContract } = build);
  } else if (!provider) {
    const platform = platformProvider();
    provider = platform?.id ?? null;
    model = platform?.model ?? null;
  }
  if ((provider && !isProviderId(provider)) || (model && !validModel(model))) {
    return NextResponse.json({ error: "Invalid model" }, { status: 400, headers });
  }
  try {
    const estimate = provider && isProviderId(provider) ? await recentBuildDuration(provider, model, needsContract) : null;
    return NextResponse.json({ estimate, startedAt: startedAt?.toISOString() ?? null, serverNow: new Date().toISOString() }, { headers });
  } catch {
    // Estimation cannot block submission or interrupt the build stream.
    return NextResponse.json({ error: "Build-time estimate is unavailable." }, { status: 503, headers });
  }
}
