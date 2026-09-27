import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { PoolClient } from "pg";
import type { CleanAgentSession } from "@/lib/agent/cli-continuation";
import type { BuildExecution } from "./execution";
import { assertWorkerExecution } from "./execution";
import { createSourceCheckpoint, verifySourceCheckpoint, verifyWorkspaceCheckpoint } from "./checkpoints";
import { appendWorkerEvent, lockedWorkerClaim, recordWorkerCheckpoint, workerTransaction } from "./ownership";

interface ContinuationReceipt { sourceHash: string; sessionHash: string; sessionId: string; operations: number; seq: number }
interface SavedContinuation { session: CleanAgentSession; context: Record<string, unknown> }

export async function saveAgentContinuation(execution: BuildExecution): Promise<void> {
  if (!execution.cleanSession || !execution.continuationContext) return;
  async function quiescent(): Promise<void> {
    await assertWorkerExecution(execution);
    if (execution.activeKey || execution.containers.size) throw new Error("Agent continuation still has active work.");
  }
  const source = await createSourceCheckpoint({ workspace: execution.workspace, archiveRoot: execution.archiveRoot,
    buildId: execution.claim.buildId, attempt: execution.claim.attempt, stage: "agent_continuation", assertQuiescent: quiescent });
  await recordWorkerCheckpoint(execution.pool, execution.claim, source.hash);
  const temporary = await mkdtemp(join(tmpdir(), "fletch-session-checkpoint-"));
  try {
    await writeFile(join(temporary, "continuation.json"), JSON.stringify({ session: execution.cleanSession, context: execution.continuationContext }), { mode: 0o600 });
    const session = await createSourceCheckpoint({ workspace: temporary, archiveRoot: execution.archiveRoot,
      buildId: execution.claim.buildId, attempt: execution.claim.attempt, stage: "kimi_0_39_1_clean_step", assertQuiescent: quiescent });
    await workerTransaction(execution.pool, async function record(client) {
      const job = await lockedWorkerClaim(client, execution.claim);
      if (job.checkpoint_hash !== source.hash) throw new Error("Source checkpoint changed before continuation.");
      const pending = await client.query("select 1 from build_worker_effects where build_id=$1 and state='uncertain' limit 1", [execution.claim.buildId]);
      if (pending.rowCount) throw new Error("An external request still needs a receipt.");
      await appendWorkerEvent(client, execution.claim.buildId, "agent_continuation", {
        sourceHash: source.hash, sessionHash: session.hash, sessionId: execution.cleanSession!.sessionId, operations: execution.nextOperation,
      });
    });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function readReceipt(client: PoolClient, buildId: string): Promise<ContinuationReceipt> {
  const rows = await client.query<ContinuationReceipt>(`select detail->>'sourceHash' as "sourceHash",detail->>'sessionHash' as "sessionHash",
    detail->>'sessionId' as "sessionId",(detail->>'operations')::integer as operations,seq
    from build_worker_events where build_id=$1 and kind='agent_continuation' order by seq desc limit 1`, [buildId]);
  const receipt = rows.rows[0];
  if (!receipt) throw new Error("This build has no supported clean continuation.");
  const unsafe = await client.query(`select 1 from build_worker_effects where build_id=$1 and state='uncertain'
    union all select 1 from build_worker_events where build_id=$1 and seq>$2 and kind='effect_intent' limit 1`, [buildId, receipt.seq]);
  if (unsafe.rowCount) throw new Error("Work after the saved session requires reconciliation.");
  return receipt;
}

async function readArchive(archiveRoot: string, buildId: string, receipt: ContinuationReceipt): Promise<SavedContinuation> {
  const source = await verifySourceCheckpoint(archiveRoot, receipt.sourceHash);
  const session = await verifySourceCheckpoint(archiveRoot, receipt.sessionHash);
  if (source.manifest.buildId !== buildId || session.manifest.buildId !== buildId ||
      source.manifest.stage !== "agent_continuation" || session.manifest.stage !== "kimi_0_39_1_clean_step" ||
      session.manifest.files.length !== 1 || session.manifest.files[0].path !== "continuation.json") throw new Error("Continuation identity changed.");
  const saved = JSON.parse(await readFile(join(session.path, "files/continuation.json"), "utf8")) as SavedContinuation;
  if (saved.session.sessionId !== receipt.sessionId || saved.context.phase !== "initial_agent") throw new Error("Unsupported continuation stage.");
  return saved;
}

export async function validateBudgetContinuation(client: PoolClient, buildId: string): Promise<void> {
  const result = await client.query(`select j.state,j.checkpoint_hash,j.stop_requested_at,b.status,b.sandbox_id,b.error,
    b.pricing_snapshot,(select created_at from build_worker_events where build_id=b.id and kind='budget_paused' order by seq desc limit 1)
      + (b.pricing_snapshot->>'approvalWindowSeconds')::integer * interval '1 second' > clock_timestamp() as within_window
    from build_worker_jobs j join builds b on b.id=j.build_id where j.build_id=$1 for update of j,b`, [buildId]);
  const job = result.rows[0];
  if (!job || job.state !== "paused_budget" || job.status !== "paused" || job.stop_requested_at || job.sandbox_id || job.error) throw new Error("Build is not available for an allowance extension.");
  const window = job.pricing_snapshot?.approvalWindowSeconds;
  if (!Number.isInteger(window) || job.within_window !== true) throw new Error("The allowance approval window has ended. Stop this build to release its reserved credit.");
  const receipt = await readReceipt(client, buildId);
  if (job.checkpoint_hash !== receipt.sourceHash) throw new Error("The saved source checkpoint changed.");
  const archiveRoot = process.env.FORGE_CHECKPOINT_ROOT;
  if (!archiveRoot) throw new Error("Checkpoint storage is unavailable.");
  await readArchive(archiveRoot, buildId, receipt);
}

export async function restoreAgentContinuation(execution: BuildExecution): Promise<Record<string, unknown>> {
  const receipt = await workerTransaction(execution.pool, async function read(client) {
    const job = await lockedWorkerClaim(client, execution.claim);
    const saved = await readReceipt(client, execution.claim.buildId);
    if (saved.sourceHash !== job.checkpoint_hash) throw new Error("Saved source checkpoint changed.");
    return saved;
  });
  const saved = await readArchive(execution.archiveRoot, execution.claim.buildId, receipt);
  await verifyWorkspaceCheckpoint(execution.archiveRoot, receipt.sourceHash, execution.workspace);
  const home = join(execution.workspace, ".agent-home");
  if (await realpath(home) !== home) throw new Error("Agent home must not follow links.");
  const temporary = await mkdtemp(join(execution.workspace, ".session-restore-"));
  try {
    for (const [path, text] of Object.entries(saved.session.files)) {
      if (!path.startsWith(".agent-home/.kimi-code/") || path.includes("..") || path.includes("\\") || path.includes("\0")) throw new Error("Invalid saved session path.");
      const relative = path.slice(".agent-home/".length);
      await mkdir(dirname(join(temporary, relative)), { recursive: true, mode: 0o700 });
      await writeFile(join(temporary, relative), text, { flag: "wx", mode: 0o600 });
    }
    await assertWorkerExecution(execution);
    // Retain the original session for diagnosis; it is outside customer source
    // and never replaces the immutable continuation archive.
    await rename(home, join(execution.archiveRoot, `.previous-session-${execution.claim.buildId}-${randomUUID()}`));
    await rename(temporary, home);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  execution.nextOperation = receipt.operations;
  execution.cleanSession = saved.session;
  return saved.context;
}

export async function pauseAgentBudget(execution: BuildExecution, reason: string): Promise<void> {
  await workerTransaction(execution.pool, async function pause(client) {
    const job = await lockedWorkerClaim(client, execution.claim);
    if (execution.containers.size || execution.activeKey) throw new Error("Budget pause requires confirmed cleanup.");
    const receipt = await readReceipt(client, execution.claim.buildId);
    if (job.checkpoint_hash !== receipt.sourceHash) throw new Error("Budget pause has no current continuation.");
    await readArchive(execution.archiveRoot, execution.claim.buildId, receipt);
    await verifyWorkspaceCheckpoint(execution.archiveRoot, receipt.sourceHash, execution.workspace);
    await client.query("update builds set status='paused',sandbox_id=null,error=null where id=$1", [execution.claim.buildId]);
    await client.query("update build_worker_jobs set state='paused_budget',lease_expires_at=null where build_id=$1", [execution.claim.buildId]);
    await appendWorkerEvent(client, execution.claim.buildId, "budget_paused", { reason, checkpointHash: receipt.sourceHash });
  });
}

// Recovery may queue only the exact clean boundary, with no dispatched work
// after it. A missing receipt, a newer source file or any sandbox still recorded
// leaves the existing held state untouched.
export async function queueCleanAgentContinuation(execution: Pick<BuildExecution, "pool" | "archiveRoot" | "workspace">, buildId: string): Promise<boolean> {
  return workerTransaction(execution.pool, async function reconcile(client) {
    const result = await client.query(`select j.checkpoint_hash,b.sandbox_id from build_worker_jobs j join builds b on b.id=j.build_id
      where j.build_id=$1 and j.state='recovery_required' and j.lease_expires_at<=clock_timestamp()
        and j.stop_requested_at is null and b.error is null and b.sandbox_id is null for update of j,b`, [buildId]);
    const job = result.rows[0];
    if (!job) return false;
    const receipt = await readReceipt(client, buildId);
    if (receipt.sourceHash !== job.checkpoint_hash) throw new Error("Source checkpoint changed after the clean session.");
    await readArchive(execution.archiveRoot, buildId, receipt);
    await verifyWorkspaceCheckpoint(execution.archiveRoot, receipt.sourceHash, execution.workspace);
    await client.query("update build_worker_jobs set state='queued',owner_id=null,fence=null,lease_expires_at=null where build_id=$1", [buildId]);
    await client.query("update builds set status='queued' where id=$1", [buildId]);
    await appendWorkerEvent(client, buildId, "clean_continuation_queued", { checkpointHash: receipt.sourceHash });
    return true;
  });
}
