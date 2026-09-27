import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

// Liveness always returns 200. Readiness (?deep=1) also pings the database, so a
// load balancer can gate traffic on a reachable DB without failing liveness.
// The deep check touches the database, so an anonymous caller could use it as a
// free DB probe. The result is cached briefly: monitoring still gets fresh-enough
// readiness, a flood costs one query per window.
let lastDeep = { at: 0, ok: false };
const DEEP_TTL_MS = 5_000;

export async function GET(request: Request): Promise<Response> {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  if (!deep) {
    return NextResponse.json({ status: "ok" });
  }
  const now = Date.now();
  if (now - lastDeep.at < DEEP_TTL_MS) {
    return lastDeep.ok
      ? NextResponse.json({ status: "ok", db: "up", cached: true })
      : NextResponse.json({ status: "degraded", db: "down", cached: true }, { status: 503 });
  }
  try {
    await db.execute(sql`select 1`);
    lastDeep = { at: now, ok: true };
    return NextResponse.json({ status: "ok", db: "up" });
  } catch {
    lastDeep = { at: now, ok: false };
    return NextResponse.json({ status: "degraded", db: "down" }, { status: 503 });
  }
}
