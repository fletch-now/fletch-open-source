import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

const connectionString = process.env.DATABASE_URL ?? "";

// The pool is lazy: no connection is opened until the first query, so importing
// this module during `next build` does not require a reachable database.
export const pool = new Pool({
  connectionString,
  // node-postgres defaults to 10 connections and waits forever to acquire one.
  // Every streamed build event does an awaited insert, so a burst of builds could
  // exhaust the pool and stall every request behind it with no error.
  max: Number(process.env.PGPOOL_MAX ?? 4),
  application_name: process.env.PGAPPNAME ?? "fletch",
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
});

export const db = drizzle(pool, { schema });
export { schema };

// Only the daemon (workers/watch.ts) calls this, on SIGTERM/SIGINT — a Next.js
// request handler never owns the pool's lifetime and must not end it out from
// under other requests.
export async function close(): Promise<void> {
  await pool.end();
}
