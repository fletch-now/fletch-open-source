import "server-only";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool, type PoolClient } from "pg";
import { pool as defaultPool } from "@/lib/db";
import { logEvent } from "@/lib/log";
import { buildSignal } from "./cancellation";

// External operations hold session locks while normal connections remain free
// for their fenced receipts and worker heartbeats.
const coordinationPools = new WeakMap<Pool, Pool>();
const MAX_LOCKS = 4;

function coordinationPool(database: Pool): Pool {
  let pool = coordinationPools.get(database);
  if (!pool) {
    pool = new Pool({ ...database.options, max: MAX_LOCKS, connectionTimeoutMillis: 1000, query_timeout: 1000, statement_timeout: 1000, idleTimeoutMillis: 1000, allowExitOnIdle: true });
    pool.on("error", function idleConnectionLost() { logEvent("build-lock", { event: "idle-connection-lost" }); });
    coordinationPools.set(database, pool);
  }
  return pool;
}

function resourceLockKey(resource: string): string {
  return createHash("sha256").update(`fletch-resource-v1:${resource}`).digest().readBigInt64BE().toString();
}

interface ResourceLockOptions {
  database?: Pool;
  signal?: AbortSignal;
  skipBusy?: boolean;
}

export function withResourceLock<T>(resource: string, operation: (signal: AbortSignal) => Promise<T>, options: ResourceLockOptions & { skipBusy: true }): Promise<T | undefined>;
export function withResourceLock<T>(resource: string, operation: (signal: AbortSignal) => Promise<T>, options?: ResourceLockOptions & { skipBusy?: false }): Promise<T>;
export async function withResourceLock<T>(resource: string, operation: (signal: AbortSignal) => Promise<T>, options: ResourceLockOptions = {}): Promise<T | undefined> {
  const pool = coordinationPool(options.database ?? defaultPool);
  const signal = options.signal ?? buildSignal();
  const key = resourceLockKey(resource);
  let client: PoolClient | undefined;
  while (!client) {
    signal?.throwIfAborted();
    // Do not fill the pool's pending queue with builds waiting for another lock.
    if (pool.idleCount > 0 || pool.totalCount < MAX_LOCKS) {
      const candidate = await pool.connect();
      try {
        signal?.throwIfAborted();
        const result = await candidate.query<{ acquired: boolean }>("select pg_try_advisory_lock($1::bigint) as acquired", [key]);
        if (result.rows[0].acquired) client = candidate;
        else candidate.release();
      } catch (cause) {
        candidate.release(true);
        throw cause;
      }
    }
    if (!client) {
      if (options.skipBusy) return undefined;
      await delay(100, undefined, { signal });
    }
  }
  const lost = new AbortController();
  function connectionLost(): void { lost.abort(new Error("The external-operation lock was lost.")); }
  client.on("error", connectionLost);
  client.on("end", connectionLost);
  const ownedSignal = signal ? AbortSignal.any([signal, lost.signal]) : lost.signal;
  try {
    ownedSignal.throwIfAborted();
    const result = await operation(ownedSignal);
    lost.signal.throwIfAborted();
    return result;
  } finally {
    client.removeListener("error", connectionLost);
    client.removeListener("end", connectionLost);
    if (lost.signal.aborted) client.release(true);
    else {
      try { await client.query("select pg_advisory_unlock($1::bigint)", [key]); }
      catch { client.release(true); client = undefined; }
      client?.release();
    }
  }
}
