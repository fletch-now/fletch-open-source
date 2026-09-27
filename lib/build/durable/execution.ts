import type { AllowanceReading } from "../pricing-budget";
import { withBuildCancellation } from "../cancellation";
import { BuildBudgetPause, guardWorkerAllowance, recordWorkerActiveTime, workerAllowance } from "./budget";
import type { CleanAgentSession } from "@/lib/agent/cli-continuation";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import { createSourceCheckpoint } from "./checkpoints";
import { appendWorkerEvent, beginWorkerEffect, completeWorkerEffect, lockedWorkerClaim, recordWorkerCheckpoint, workerTransaction, type EffectKind, type Receipt, type WorkerClaim } from "./ownership";

export interface BuildExecution {
  pool: Pool;
  claim: WorkerClaim;
  workspace: string;
  archiveRoot: string;
  signal: AbortSignal;
  nextOperation: number;
  activeKey: string | null;
  containers: Set<string>;
  allowOperations?: boolean;
  cleanSession?: CleanAgentSession;
  continuationContext?: Record<string, unknown>;
  restoredContext?: Record<string, unknown>;
}

const shared = globalThis as typeof globalThis & { __fletchWorkerExecution?: AsyncLocalStorage<BuildExecution> };
const storage = shared.__fletchWorkerExecution ??= new AsyncLocalStorage<BuildExecution>();

export function currentWorkerExecution(): BuildExecution | undefined { return storage.getStore(); }

export function withWorkerExecution<T>(execution: BuildExecution, run: () => T): T { return storage.run(execution, run); }

export async function assertWorkerExecution(execution = currentWorkerExecution()): Promise<void> {
  if (!execution) return;
  execution.signal.throwIfAborted();
  await workerTransaction(execution.pool, async function check(client) { await lockedWorkerClaim(client, execution.claim); });
}

export async function recordWorkerProgress(execution: BuildExecution, text: string): Promise<void> {
  await workerTransaction(execution.pool, async function record(client) {
    await lockedWorkerClaim(client, execution.claim);
    const event = { phase: "planning", text, at: new Date().toISOString() };
    await client.query(`insert into build_logs(id,build_id,seq,level,chunk)
      select $1,$2,coalesce(max(seq),-1)+1,'planning',$3 from build_logs where build_id=$2`,
    [randomUUID(), execution.claim.buildId, JSON.stringify(event)]);
  });
}

export async function recordWorkerContext(execution: BuildExecution, summary: string, requestKey: string): Promise<void> {
  await workerTransaction(execution.pool, async function record(client) {
    await lockedWorkerClaim(client, execution.claim);
    const position = await client.query<{ seq: number }>("select coalesce(max(seq),-1) as seq from build_logs where build_id=$1", [execution.claim.buildId]);
    await appendWorkerEvent(client, execution.claim.buildId, "context_summary", {
      summary, requestKey, logSeq: position.rows[0].seq,
    });
  });
}

export async function recordWorkerDispatchEvidence(kind: string, detail: Receipt): Promise<void> {
  const execution = currentWorkerExecution();
  if (!execution) return;
  await workerTransaction(execution.pool, async function evidence(client) {
    await lockedWorkerClaim(client, execution.claim);
    await appendWorkerEvent(client, execution.claim.buildId, kind, { ...detail, effectKey: execution.activeKey });
  });
}

export async function saveCheckpoint(execution: BuildExecution, stage: string): Promise<void> {
  await mkdir(execution.workspace, { recursive: true });
  const checkpoint = await createSourceCheckpoint({
    workspace: execution.workspace, archiveRoot: execution.archiveRoot, buildId: execution.claim.buildId,
    attempt: execution.claim.attempt, stage,
    async assertQuiescent() {
      await assertWorkerExecution(execution);
      if (execution.containers.size) throw new Error("Sandbox is still writing the workspace.");
    },
  });
  await recordWorkerCheckpoint(execution.pool, execution.claim, checkpoint.hash);
}

async function beginOperation(execution: BuildExecution, label: string, kind: EffectKind): Promise<{ key: string; allowance: AllowanceReading }> {
  if (execution.allowOperations === false) throw new Error("The builder tried to dispatch work after its final response.");
  const key = `${++execution.nextOperation}:${label}`;
  const allowance = await workerAllowance(execution);
  if (!allowance.allowed || kind === "model" && allowance.remaining?.modelRequests === 0) throw new BuildBudgetPause(allowance.reason ?? "model_requests");
  if (kind === "tool" || kind === "model" && label !== "agent-turn") {
    await guardWorkerAllowance(execution, key, kind === "tool" ? "tool_run" : "model_request");
  }
  await saveCheckpoint(execution, `before:${label}`);
  await beginWorkerEffect(execution.pool, execution.claim, key, kind);
  execution.activeKey = key;
  return { key, allowance };
}

export async function workerOperation<T>(label: string, kind: EffectKind, operation: () => Promise<T>): Promise<T> {
  const execution = currentWorkerExecution();
  if (!execution || execution.activeKey) return operation();
  const { key, allowance } = await beginOperation(execution, label, kind);
  let dispatched = false;
  const startedAt = performance.now();
  const signal = allowance.remaining ? AbortSignal.any([execution.signal, AbortSignal.timeout(Math.max(1, allowance.remaining.activeSeconds * 1000))]) : execution.signal;
  try {
    await assertWorkerExecution(execution);
    dispatched = true;
    const result = await withBuildCancellation(signal, operation);
    await recordWorkerActiveTime(execution, key, startedAt);
    await completeWorkerEffect(execution.pool, execution.claim, key, { outcome: "returned", result } as Receipt);
    execution.activeKey = null;
    if (!execution.signal.aborted) await saveCheckpoint(execution, `after:${label}`);
    return result;
  } catch (cause) {
    if (!dispatched) await completeWorkerEffect(execution.pool, execution.claim, key, { outcome: "not_dispatched" });
    throw cause;
  } finally {
    execution.activeKey = null;
  }
}

export async function* workerEvents<T>(label: string, kind: EffectKind, operation: () => AsyncIterable<T>): AsyncIterable<T> {
  const execution = currentWorkerExecution();
  if (!execution || execution.activeKey) { yield* operation(); return; }
  const { key, allowance } = await beginOperation(execution, label, kind);
  let dispatched = false;
  const startedAt = performance.now();
  const signal = allowance.remaining ? AbortSignal.any([execution.signal, AbortSignal.timeout(Math.max(1, allowance.remaining.activeSeconds * 1000))]) : execution.signal;
  try {
    await assertWorkerExecution(execution);
    dispatched = true;
    const iterator = operation()[Symbol.asyncIterator]();
    try {
      while (true) {
        const item = await withBuildCancellation(signal, () => iterator.next());
        if (item.done) break;
        yield item.value;
      }
    } finally { await withBuildCancellation(signal, () => iterator.return?.()); }
    await recordWorkerActiveTime(execution, key, startedAt);
    await completeWorkerEffect(execution.pool, execution.claim, key, { outcome: "returned" });
    execution.activeKey = null;
    if (!execution.signal.aborted) await saveCheckpoint(execution, `after:${label}`);
  } catch (cause) {
    if (!dispatched) await completeWorkerEffect(execution.pool, execution.claim, key, { outcome: "not_dispatched" });
    throw cause;
  } finally {
    execution.activeKey = null;
  }
}

export async function registerWorkerContainer(name: string): Promise<void> {
  const execution = currentWorkerExecution();
  if (!execution) return;
  await workerTransaction(execution.pool, async function register(client) {
    await lockedWorkerClaim(client, execution.claim);
    await client.query("update builds set sandbox_id=$2 where id=$1", [execution.claim.buildId, name]);
  });
  execution.containers.add(name);
}

export async function removeOwnedContainer(name: string): Promise<void> {
  if (!/^fletch-[a-z]+-[a-f0-9-]+$/.test(name)) throw new Error("Recorded sandbox name is invalid.");
  await new Promise<void>(function remove(resolve, reject) {
    execFile("docker", ["rm", "--force", name], { timeout: 10_000 }, function removed(error, _out, stderr) {
      if (error && !stderr.includes("No such container")) reject(error);
      else resolve();
    });
  });
}

export async function releaseWorkerContainer(name: string): Promise<void> {
  const execution = currentWorkerExecution();
  if (!execution) return;
  await removeOwnedContainer(name);
  execution.containers.delete(name);
  await workerTransaction(execution.pool, async function release(client) {
    await lockedWorkerClaim(client, execution.claim, true);
    await client.query("update builds set sandbox_id=null where id=$1 and sandbox_id=$2", [execution.claim.buildId, name]);
  });
}
