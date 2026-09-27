import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { seedRegistry, syncRegistry } from "@/lib/registry/sync";
import { logEvent } from "@/lib/log";

// Cron endpoint (e.g. hourly). Guarded by the same shared-secret header as
// app/api/internal/reap/route.ts, and disabled entirely when the secret is unset.
export async function POST(request: NextRequest): Promise<Response> {
  const secret = process.env.INTERNAL_CRON_SECRET;
  if (!secret || request.headers.get("x-forge-cron") !== secret) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const seeded = await seedRegistry();
  const synced = await syncRegistry();
  logEvent("registry", { seededInserted: seeded.inserted, ...synced });
  return NextResponse.json({ seeded, ...synced });
}
