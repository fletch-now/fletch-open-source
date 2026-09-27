import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { buildLogs, builds, projects } from "@/lib/db/schema";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";
import { readBuildQueue } from "@/lib/build/queue";
import type { BuildEvent } from "@/lib/build/types";

export interface ActiveBuild {
  id: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
  since: string;
  // The last thing the build reported, so a sidebar can say what it is doing.
  step: string | null;
  // Builds ahead of this one while it waits for a slot; 0 once running.
  ahead: number;
}

// The signed-in person's builds that are still going, for the "build in
// progress" indicator that follows them around the dashboard.
export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: builds.id,
      projectId: builds.projectId,
      projectName: projects.name,
      status: builds.status,
      createdAt: builds.createdAt,
      startedAt: builds.startedAt,
    })
    .from(builds)
    .leftJoin(projects, eq(projects.id, builds.projectId))
    .where(and(eq(builds.userId, session.user.id), inArray(builds.status, RUNNING_BUILD_STATUSES)))
    .orderBy(asc(builds.createdAt));

  const active: ActiveBuild[] = [];
  for (const row of rows) {
    const last = await db
      .select({ chunk: buildLogs.chunk })
      .from(buildLogs)
      .where(eq(buildLogs.buildId, row.id))
      .orderBy(desc(buildLogs.seq))
      .limit(1);
    let step: string | null = null;
    if (last[0]?.chunk) {
      try {
        step = (JSON.parse(last[0].chunk) as BuildEvent).text;
      } catch {
        step = null;
      }
    }
    const ahead = row.status === "queued" ? (await readBuildQueue(row.id))?.ahead ?? 0 : 0;
    active.push({
      id: row.id,
      projectId: row.projectId,
      projectName: row.projectName,
      status: row.status,
      since: (row.startedAt ?? row.createdAt).toISOString(),
      step,
      ahead,
    });
  }
  return NextResponse.json({ builds: active }, { headers: { "Cache-Control": "no-store" } });
}
