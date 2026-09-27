import { hasUncertainPublication, withSiteLock } from "@/lib/hosting/site-lock";
import { STOP_REQUESTED } from "@/lib/build/cancellation";
import "server-only";
import { readdir, readlink, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, lt, sql } from "drizzle-orm";
import type { Pool } from "pg";
import { db, pool } from "@/lib/db";
import { builds } from "@/lib/db/schema";
import { failClaimedBuild } from "@/lib/build/queue";
import { logEvent } from "@/lib/log";
import { directoryBytes } from "@/lib/build/workspace";

// Fails builds stuck in 'building' past a deadline (the process driving them
// died, so no event will ever finish them) and refunds the reserved credit. Run
// on a cron via /api/internal/reap. A closed tab is not a reason: the runner in
// lib/build/runner.ts keeps driving a build no one is watching.
// 150 minutes: the worst legitimate build is two agent turns at the 45-minute
// limit, three forge runs, a deploy receipt, verification polling and a vite
// build. A shorter deadline reaps builds that are still working and hands out
// a refund for work that then succeeds.
export async function reapStaleBuilds(maxAgeMinutes = 150, database: typeof db = db): Promise<number> {
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
  // Waiting time is not execution time. Queued rows survive restarts and wait
  // until capacity becomes available or their owner explicitly cancels them.
  const stale = await database
    .select({ id: builds.id, userId: builds.userId, status: builds.status })
    .from(builds)
    .where(and(eq(builds.status, "building"), lt(builds.startedAt, cutoff), sql`${builds.error} is distinct from ${STOP_REQUESTED}`,
      sql`not exists (select 1 from build_worker_jobs j where j.build_id=${builds.id})`));

  let failed = 0;
  for (const build of stale) {
    // Recheck atomically: Stop may arrive after the age query above.
    if (await failClaimedBuild(build.id, build.userId, "Timed out", database, { preserveStopRequested: true })) failed += 1;
  }
  return failed;
}

// Project workspaces contain the editable sources and provider session state.
// Directory age cannot establish abandonment, and the event log is not a full
// source backup. Retain files until an explicit archival/deletion policy exists.
export interface WorkspaceSweep {
  removed: number;
  keptBytesApprox: number;
}

export async function sweepWorkspaces(root: string): Promise<WorkspaceSweep> {
  return { removed: 0, keptBytesApprox: await directoryBytes(root) };
}

// A publish copies a release under <sites>/<slug>/<buildId> and points `current`
// at it. Old releases are the rollback trail, and without a sweep every build
// of every project stays on disk forever. The current one and the two before it
// are kept; anything older goes.
export interface SiteSweep {
  removed: number;
}

export async function sweepSiteReleases(root: string, keep = 2, database: Pool = pool): Promise<SiteSweep> {
  const sites = await readdir(root, { withFileTypes: true }).catch(function missing() {
    return [];
  });
  let removed = 0;
  for (const site of sites) {
    if (!site.isDirectory()) {
      continue;
    }
    await withSiteLock(root, site.name, async function sweep(signal) {
      if (await hasUncertainPublication(site.name, database)) return;
      const siteDir = join(root, site.name);
      const current = await readlink(join(siteDir, "current")).catch(function none() {
        return null;
      });
      const entries = await readdir(siteDir, { withFileTypes: true }).catch(function missing() {
        return [];
      });
      const releases: Array<{ name: string; mtimeMs: number }> = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === current) {
          continue;
        }
        const info = await stat(join(siteDir, entry.name));
        releases.push({ name: entry.name, mtimeMs: info.mtimeMs });
      }
      releases.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const stale of releases.slice(keep)) {
        signal.throwIfAborted();
        await rm(join(siteDir, stale.name), { recursive: true, force: true });
        logEvent("reaper", { event: "release-swept", slug: site.name, release: stale.name });
        removed += 1;
      }
    }, { database, skipBusy: true });
  }
  return { removed };
}
