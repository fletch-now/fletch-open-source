import { BUILD_MAINTENANCE_KEY } from "../maintenance";
import { BUILD_CLAIM_LOCK, parseCapacity, readBuildCapacity, canAdmitWorkerBuild, type CapacityResources, type CapacityPressureReader } from "../capacity";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { STOP_REQUESTED } from "@/lib/build/cancellation";

export interface WorkerClaim {
  buildId: string;
  workspaceKey: string;
  ownerId: string;
  fence: string;
  attempt: number;
  checkpointHash: string | null;
}

export type EffectKind = "model" | "tool" | "deployment" | "publication";
export type WorkerState = "queued" | "running" | "recovery_required" | "paused_budget" | "completed" | "stopped";
export type Receipt = Record<string, unknown>;

export class WorkerFenceError extends Error {
  constructor() {
    super("Worker ownership expired, changed, or was stopped.");
    this.name = "WorkerFenceError";
  }
}

interface JobRow {
  build_id: string;
  workspace_key: string;
  state: WorkerState;
  owner_id: string | null;
  fence: string | null;
  attempt: number;
  stop_requested_at: Date | null;
  checkpoint_hash: string | null;
}

const CLAIM_LOCK = BUILD_CLAIM_LOCK;

export async function workerTransaction<T>(pool: Pool, run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await run(client);
    await client.query("commit");
    return result;
  } catch (cause) {
    await client.query("rollback");
    throw cause;
  } finally {
    client.release();
  }
}

function validateLease(leaseMs: number): void {
  if (!Number.isInteger(leaseMs) || leaseMs < 100 || leaseMs > 300_000) {
    throw new Error("Worker leases must be between 100 and 300000 milliseconds.");
  }
}

export async function lockedWorkerClaim(client: PoolClient, claim: WorkerClaim, allowStop = false): Promise<JobRow> {
  const result = await client.query<JobRow>(`
    select j.* from build_worker_jobs j join builds b on b.id=j.build_id
    where j.build_id=$1 and j.owner_id=$2 and j.fence=$3 and j.attempt=$4
      and j.state='running' and j.lease_expires_at > clock_timestamp()
      and ($5 or (j.stop_requested_at is null and b.error is distinct from $6))
    for update of j,b
  `, [claim.buildId, claim.ownerId, claim.fence, claim.attempt, allowStop, STOP_REQUESTED]);
  if (!result.rows[0]) throw new WorkerFenceError();
  // The lease may expire while SELECT waits for a row lock, even when the
  // blocking transaction never changes that row. Recheck after acquiring it.
  const live = await client.query("select 1 from build_worker_jobs where build_id=$1 and lease_expires_at > clock_timestamp()", [claim.buildId]);
  if (!live.rows[0]) throw new WorkerFenceError();
  return result.rows[0];
}

export async function appendWorkerEvent(client: PoolClient, buildId: string, kind: string, detail: Receipt): Promise<number> {
  const result = await client.query<{ last_seq: number; attempt: number }>(
    "update build_worker_jobs set last_seq=last_seq+1 where build_id=$1 returning last_seq,attempt", [buildId],
  );
  const row = result.rows[0];
  await client.query("insert into build_worker_events(build_id,seq,attempt,kind,detail) values($1,$2,$3,$4,$5)",
    [buildId, row.last_seq, row.attempt, kind, detail]);
  return row.last_seq;
}

// Submission enrolls only newly accepted builds when worker routing is enabled.
// Legacy accepted rows keep their original execution path.
export async function enrollWorkerBuild(pool: Pool, buildId: string): Promise<boolean> {
  const result = await pool.query(`
    insert into build_worker_jobs(build_id,workspace_key)
    select id,case when project_id is null then 'build:'||id else 'project:'||project_id end
    from builds where id=$1 and status='queued'
    on conflict (build_id) do nothing returning build_id
  `, [buildId]);
  return result.rows.length === 1;
}

export async function claimWorkerBuild(pool: Pool, ownerId: string, leaseMs = 30_000, localCapacity?: number, resources?: CapacityResources, pressureReader?: CapacityPressureReader): Promise<WorkerClaim | null> {
  validateLease(leaseMs);
  if (!ownerId.trim()) throw new Error("Worker needs an owner ID.");
  if (localCapacity !== undefined) parseCapacity(localCapacity);
  return workerTransaction(pool, async function claim(client) {
    await client.query("select pg_advisory_xact_lock($1)", [CLAIM_LOCK]);
    const maintenance = await client.query("select 1 from app_settings where key=$1", [BUILD_MAINTENANCE_KEY]);
    if (maintenance.rows.length) return null;
    const sharedCapacity = await readBuildCapacity(client);
    const capacity = Math.min(sharedCapacity, localCapacity ?? sharedCapacity);
    // An expired owner continues to hold capacity and its project until its
    // sandbox and uncertain external effects have been reconciled.
    const active = await client.query<{ count: string }>("select count(*) from builds where status in ('provisioning','building','compiling')");
    if (Number(active.rows[0].count) >= capacity) return null;
    const next = await client.query<JobRow>(`
      select j.* from build_worker_jobs j where state='queued' and stop_requested_at is null
      and exists (select 1 from builds b where b.id=j.build_id and b.status='queued' and b.error is distinct from $1)
      and not exists (select 1 from build_worker_jobs active where active.workspace_key=j.workspace_key
        and active.state in ('running','recovery_required','paused_budget'))
      and not exists (select 1 from builds active where active.project_id is not null
        and 'project:'||active.project_id=j.workspace_key and active.status in ('provisioning','building','compiling'))
      order by created_at,build_id limit 1 for update
    `, [STOP_REQUESTED]);
    const job = next.rows[0];
    if (!job) return null;
    // Probe actual aggregate limits only when a job could start, not on idle polls.
    if (!await canAdmitWorkerBuild(client, Number(active.rows[0].count), resources, pressureReader)) return null;
    const fence = randomUUID();
    const updated = await client.query<{ attempt: number }>(`
      update build_worker_jobs set state='running',owner_id=$2,fence=$3,attempt=attempt+1,
        heartbeat_at=clock_timestamp(),lease_expires_at=clock_timestamp()+$4*interval '1 millisecond'
      where build_id=$1 returning attempt
    `, [job.build_id, ownerId, fence, leaseMs]);
    await client.query("update builds set status='building',started_at=coalesce(started_at,clock_timestamp()),trigger_run_id=$2 where id=$1 and status='queued'", [job.build_id, fence]);
    await appendWorkerEvent(client, job.build_id, "claimed", { ownerId });
    return { buildId: job.build_id, workspaceKey: job.workspace_key, ownerId, fence, attempt: updated.rows[0].attempt, checkpointHash: job.checkpoint_hash };
  });
}

export async function heartbeatWorker(pool: Pool, claim: WorkerClaim, leaseMs = 30_000): Promise<{ stopRequested: boolean }> {
  validateLease(leaseMs);
  return workerTransaction(pool, async function heartbeat(client) {
    await lockedWorkerClaim(client, claim, true);
    const result = await client.query<{ stop_requested_at: Date | null }>(`
      update build_worker_jobs j set heartbeat_at=clock_timestamp(),
        lease_expires_at=clock_timestamp()+$2*interval '1 millisecond',
        stop_requested_at=case when exists (select 1 from builds b where b.id=j.build_id and b.error=$3)
          then coalesce(stop_requested_at,clock_timestamp()) else stop_requested_at end
      where build_id=$1 returning stop_requested_at
    `, [claim.buildId, leaseMs, STOP_REQUESTED]);
    return { stopRequested: result.rows[0].stop_requested_at !== null };
  });
}

export async function requestWorkerStop(pool: Pool, buildId: string, userId: string): Promise<boolean> {
  return workerTransaction(pool, async function stop(client) {
    const result = await client.query(`
      update build_worker_jobs j set stop_requested_at=coalesce(stop_requested_at,clock_timestamp()),
        state=case when state='queued' then 'stopped' else state end
      where build_id=$1 and state in ('queued','running','recovery_required','paused_budget')
        and exists (select 1 from builds b where b.id=j.build_id and b.user_id=$2)
      returning build_id
    `, [buildId, userId]);
    if (!result.rows[0]) return false;
    await appendWorkerEvent(client, buildId, "stop_requested", {});
    return true;
  });
}

export async function recordWorkerCheckpoint(pool: Pool, claim: WorkerClaim, hash: string): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Checkpoint must have a SHA-256 manifest hash.");
  return workerTransaction(pool, async function checkpoint(client) {
    await lockedWorkerClaim(client, claim);
    const pending = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' limit 1", [claim.buildId]);
    if (pending.rows[0]) throw new Error("Cannot checkpoint until the current effect has a receipt.");
    await client.query("update build_worker_jobs set checkpoint_hash=$2 where build_id=$1", [claim.buildId, hash]);
    return appendWorkerEvent(client, claim.buildId, "checkpoint", { hash });
  });
}

export async function beginWorkerEffect(pool: Pool, claim: WorkerClaim, key: string, kind: EffectKind, parentKey?: string): Promise<void> {
  if (!key || key.length > 200) throw new Error("An effect needs a stable key of at most 200 characters.");
  await workerTransaction(pool, async function begin(client) {
    const job = await lockedWorkerClaim(client, claim);
    if (!job.checkpoint_hash) throw new Error("Save a verified checkpoint before dispatch.");
    const pending = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' and effect_key is distinct from $2 limit 1", [claim.buildId, parentKey ?? null]);
    if (pending.rows[0]) throw new Error("An effect is still uncertain; reconcile it before continuing.");
    if (parentKey) {
      const parent = await client.query("select 1 from build_worker_effects where build_id=$1 and effect_key=$2 and state='uncertain' and attempt=$3", [claim.buildId, parentKey, claim.attempt]);
      if (!parent.rows[0]) throw new WorkerFenceError();
    }
    // Never interpret an existing intent as permission to retry, including an
    // intent whose remote response arrived just before the worker crashed.
    const result = await client.query(`
      insert into build_worker_effects(build_id,effect_key,attempt,kind,checkpoint_hash)
      values($1,$2,$3,$4,$5) on conflict do nothing returning effect_key
    `, [claim.buildId, key, claim.attempt, kind, job.checkpoint_hash]);
    if (!result.rows[0]) throw new Error("Effect already has a durable intent; reconcile its outcome before continuing.");
    await appendWorkerEvent(client, claim.buildId, "effect_intent", { key, kind, checkpointHash: job.checkpoint_hash });
  });
}

export async function completeWorkerEffect(pool: Pool, claim: WorkerClaim, key: string, receipt: Receipt): Promise<void> {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("Effect receipt must be an object.");
  await workerTransaction(pool, async function complete(client) {
    // A stopped owner may record the receipt of work already dispatched. It
    // cannot dispatch more work or turn that late receipt into build success.
    await lockedWorkerClaim(client, claim, true);
    const result = await client.query(`
      update build_worker_effects set state='completed',receipt=$4,completed_at=clock_timestamp()
      where build_id=$1 and effect_key=$2 and attempt=$3 and state='uncertain' returning effect_key
    `, [claim.buildId, key, claim.attempt, receipt]);
    if (!result.rows[0]) throw new Error("Effect is missing or already has a receipt.");
    await appendWorkerEvent(client, claim.buildId, "effect_receipt", { key });
  });
}

export async function readCompletedWorkerEffect(pool: Pool, claim: WorkerClaim, key: string, kind: EffectKind): Promise<Receipt | null> {
  return workerTransaction(pool, async function read(client) {
    await lockedWorkerClaim(client, claim);
    const result = await client.query<{ kind: EffectKind; state: string; receipt: Receipt }>(
      "select kind,state,receipt from build_worker_effects where build_id=$1 and effect_key=$2", [claim.buildId, key],
    );
    const effect = result.rows[0];
    if (!effect) return null;
    if (effect.kind !== kind || effect.state !== "completed") throw new Error("Effect identity or outcome needs reconciliation.");
    return effect.receipt;
  });
}

export interface WorkerRecoveryEvidence {
  verifiedCheckpointHash: string;
  // A platform reconciliation adapter verifies actual container exit and
  // credential revocation, and stores a receipt outside the agent workspace.
  cleanupReceipt: string;
}

export async function reconcileWorkerBuild(
  pool: Pool,
  prior: WorkerClaim,
  verify: (checkpointHash: string) => Promise<WorkerRecoveryEvidence>,
): Promise<"queued" | "stopped"> {
  const initial = await pool.query<{ checkpoint_hash: string | null }>(`
    select checkpoint_hash from build_worker_jobs where build_id=$1 and owner_id=$2 and fence=$3
      and attempt=$4 and state='recovery_required'
  `, [prior.buildId, prior.ownerId, prior.fence, prior.attempt]);
  const hash = initial.rows[0]?.checkpoint_hash;
  if (!hash) throw new Error("Recovery requires the recorded source checkpoint and prior attempt.");
  // Never hold a database transaction open while checking a container or archive.
  const evidence = await verify(hash);
  if (evidence.verifiedCheckpointHash !== hash || !evidence.cleanupReceipt.trim()) {
    throw new Error("Recovery requires verified source and prior-owner cleanup receipts.");
  }
  return workerTransaction(pool, async function reconcile(client) {
    const result = await client.query<JobRow>(`
      select * from build_worker_jobs where build_id=$1 and owner_id=$2 and fence=$3
        and attempt=$4 and state='recovery_required' and checkpoint_hash=$5 for update
    `, [prior.buildId, prior.ownerId, prior.fence, prior.attempt, hash]);
    const job = result.rows[0];
    if (!job) throw new WorkerFenceError();
    const unsafe = await client.query(`
      select 1 from build_worker_effects where build_id=$1 and state='uncertain'
      union all
      select 1 from build_worker_events where build_id=$1 and kind='effect_receipt'
        and seq > (select max(seq) from build_worker_events where build_id=$1 and kind='checkpoint')
      limit 1
    `, [prior.buildId]);
    if (unsafe.rows[0]) throw new Error("Recovery requires reconciled effects and a source checkpoint after their receipts.");
    const stop = await client.query("select 1 from builds where id=$1 and error=$2", [prior.buildId, STOP_REQUESTED]);
    const stopped = job.stop_requested_at !== null || stop.rows.length > 0;
    const state = stopped ? "stopped" : "queued";
    await client.query(`
      update build_worker_jobs set state=$2,lease_expires_at=null,recovery_reason=null,
        stop_requested_at=case when $3 then coalesce(stop_requested_at,clock_timestamp()) else stop_requested_at end
      where build_id=$1
    `, [prior.buildId, state, stopped]);
    await client.query("update builds set status=$2 where id=$1", [prior.buildId, stopped ? "failed" : "queued"]);
    await appendWorkerEvent(client, prior.buildId, "reconciled", { state, checkpointHash: hash, cleanupReceipt: evidence.cleanupReceipt });
    return state;
  });
}

export async function finishWorkerBuild(pool: Pool, claim: WorkerClaim, stopped = false): Promise<void> {
  await workerTransaction(pool, async function finish(client) {
    const job = await lockedWorkerClaim(client, claim, stopped);
    if (stopped && !job.stop_requested_at) throw new Error("A stopped outcome requires persisted Stop intent.");
    const pending = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' limit 1", [claim.buildId]);
    if (pending.rows[0]) throw new Error("Uncertain external work requires reconciliation.");
    const state = stopped ? "stopped" : "completed";
    await client.query("update build_worker_jobs set state=$2,lease_expires_at=null where build_id=$1", [claim.buildId, state]);
    await appendWorkerEvent(client, claim.buildId, state, {});
  });
}

export async function pauseWorkerBuild(pool: Pool, claim: WorkerClaim, reason: string): Promise<void> {
  await workerTransaction(pool, async function pause(client) {
    const result = await client.query(`
      update build_worker_jobs set state='recovery_required',recovery_reason=$5
      where build_id=$1 and owner_id=$2 and fence=$3 and attempt=$4 and state='running' returning build_id
    `, [claim.buildId, claim.ownerId, claim.fence, claim.attempt, reason]);
    if (result.rows[0]) await appendWorkerEvent(client, claim.buildId, "recovery_required", { reason });
  });
}

export async function recoverExpiredWorkers(pool: Pool): Promise<string[]> {
  return workerTransaction(pool, async function recover(client) {
    const result = await client.query<{ build_id: string }>(`
      update build_worker_jobs set state='recovery_required',recovery_reason='Worker lease expired; reconcile prior execution before retry.'
      where state='running' and lease_expires_at <= clock_timestamp() returning build_id
    `);
    for (const job of result.rows) await appendWorkerEvent(client, job.build_id, "recovery_required", { reason: "lease_expired" });
    return result.rows.map(function id(row) { return row.build_id; });
  });
}

export async function readWorkerEvents(pool: Pool, buildId: string, after = 0, limit = 200): Promise<Array<{ seq: number; attempt: number; kind: string; detail: Receipt }>> {
  if (!Number.isInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new Error("Invalid worker event cursor or page size.");
  }
  const result = await pool.query<{ seq: number; attempt: number; kind: string; detail: Receipt }>(
    "select seq,attempt,kind,detail from build_worker_events where build_id=$1 and seq>$2 order by seq limit $3", [buildId, after, limit],
  );
  return result.rows;
}
