import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { reapStaleBuilds, sweepSiteReleases, sweepWorkspaces } from "@/lib/build/reaper";
import { sitesRoot } from "@/lib/hosting/publish";
import { workspaceRoot } from "@/lib/build/workspace";

// Cron endpoint (scripts/fletch-reap.timer, every 15 min). Guarded by a shared
// secret header; disabled entirely when INTERNAL_CRON_SECRET is unset, so it can't
// be hit by accident.
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || request.headers.get("x-forge-cron") !== secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const [reaped, workspaces, releases] = await Promise.all([
    reapStaleBuilds(),
    sweepWorkspaces(workspaceRoot()),
    sweepSiteReleases(sitesRoot()),
  ]);
  return NextResponse.json({ reaped, workspaces, releases });
}
