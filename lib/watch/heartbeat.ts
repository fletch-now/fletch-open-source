// The daemon's pulse. One row, upserted after every poll loop; the dashboard's
// status card reads it to tell "the daemon is actually running" from "the daemon
// died and nobody rescanned this chain in an hour" (docs/MVP.md, ticket 6).
//
// No "server-only", no next/*, no React, no lib/dal — workers/watch.ts (a plain
// `tsx` process) imports this module directly.

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { daemonHeartbeats } from "@/lib/db/schema";
import { HEARTBEAT_NAME } from "@/lib/watch/types";

export interface HeartbeatRow {
  name: string;
  lastBeatAt: Date;
  headBlock: bigint | null;
  detail: unknown;
}

// `headBlock` is null when the beat comes from a loop that didn't reach a chain
// head this run (e.g. every configured chain errored) — the UI can still tell the
// process is alive even though it has nothing fresh to report.
export async function beat(headBlock: bigint | null, detail: object): Promise<void> {
  await db
    .insert(daemonHeartbeats)
    .values({
      name: HEARTBEAT_NAME,
      lastBeatAt: sql`now()`,
      headBlock,
      detail,
    })
    .onConflictDoUpdate({
      target: daemonHeartbeats.name,
      set: { lastBeatAt: sql`now()`, headBlock, detail },
    });
}

// The registry daemon's pulse, under its own name; the watch daemon keeps `beat`.
export async function beatAs(name: string, headBlock: bigint | null, detail: object): Promise<void> {
  await db
    .insert(daemonHeartbeats)
    .values({ name, lastBeatAt: sql`now()`, headBlock, detail })
    .onConflictDoUpdate({ target: daemonHeartbeats.name, set: { lastBeatAt: sql`now()`, headBlock, detail } });
}

export async function readHeartbeatNamed(name: string): Promise<HeartbeatRow | null> {
  const rows = await db.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, name)).limit(1);
  return rows[0] ?? null;
}

export async function readHeartbeat(): Promise<HeartbeatRow | null> {
  const rows = await db.select().from(daemonHeartbeats).where(eq(daemonHeartbeats.name, HEARTBEAT_NAME)).limit(1);
  return rows[0] ?? null;
}
