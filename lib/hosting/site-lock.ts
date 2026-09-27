import "server-only";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { pool } from "@/lib/db";
import { currentWorkerExecution } from "@/lib/build/durable/execution";
import { withResourceLock } from "@/lib/build/resource-lock";

interface SiteLockOptions { database?: Pool; skipBusy?: boolean }

export function withSiteLock<T>(root: string, slug: string, operation: (signal: AbortSignal) => Promise<T>, options: SiteLockOptions & { skipBusy: true }): Promise<T | undefined>;
export function withSiteLock<T>(root: string, slug: string, operation: (signal: AbortSignal) => Promise<T>, options?: SiteLockOptions & { skipBusy?: false }): Promise<T>;
export function withSiteLock<T>(root: string, slug: string, operation: (signal: AbortSignal) => Promise<T>, options: SiteLockOptions = {}): Promise<T | undefined> {
  const database = options.database ?? currentWorkerExecution()?.pool ?? pool;
  const key = `site:${resolve(root)}:${slug}`;
  if (options.skipBusy) return withResourceLock(key, operation, { database, skipBusy: true });
  return withResourceLock(key, operation, { database });
}

export async function hasUncertainPublication(slug: string, database: Pool = pool): Promise<boolean> {
  const result = await database.query(`select 1 from build_worker_effects e join build_worker_events v
    on v.build_id=e.build_id and v.attempt=e.attempt and v.detail->>'effectKey'=e.effect_key
    where e.kind='publication' and e.state='uncertain' and v.kind='publication_prepared'
      and v.detail->>'slug'=$1 limit 1`, [slug]);
  return result.rows.length > 0;
}
