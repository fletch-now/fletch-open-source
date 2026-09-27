import type { Pool } from "pg";
import {
  beginWorkerEffect, claimWorkerBuild, completeWorkerEffect, finishWorkerBuild,
  heartbeatWorker, pauseWorkerBuild, readCompletedWorkerEffect, recordWorkerCheckpoint,
  type EffectKind, type Receipt, type WorkerClaim,
} from "@/lib/build/durable/ownership";

export interface WorkerContext {
  claim: WorkerClaim;
  signal: AbortSignal;
  checkpoint: (hash: string) => Promise<void>;
  effect: (key: string, kind: EffectKind, dispatch: (signal: AbortSignal) => Promise<Receipt>) => Promise<Receipt>;
}

export interface WorkerAdapter {
  run: (context: WorkerContext) => Promise<void>;
  // Must confirm all owned processes and credential leases are stopped. Failure
  // keeps the workspace reserved, even when the application user pressed Stop.
  cleanup: (claim: WorkerClaim) => Promise<void>;
  settle?: (claim: WorkerClaim, stopped: boolean) => Promise<void>;
  // Runs only after confirmed cleanup and a renewed ownership check. Return
  // false when an external effect still requires reconciliation.
  pauseAfterCleanup?: (claim: WorkerClaim, cause: unknown) => Promise<boolean>;
  failAfterCleanup?: (claim: WorkerClaim, cause: unknown) => Promise<boolean>;
  heartbeat?: () => Promise<void>;
}

export interface WorkerOptions {
  leaseMs?: number;
  heartbeatMs?: number;
  capacity?: number;
  onClaim?: () => void;
  signal?: AbortSignal;
}

export type WorkerOutcome = "idle" | "completed" | "stopped" | "recovery_required" | "paused_budget";

// Own one accepted job through heartbeat, actual adapter execution, confirmed
// cleanup and fenced settlement. Interrupted work retains its project.
export async function runWorkerOnce(pool: Pool, ownerId: string, adapter: WorkerAdapter, options: WorkerOptions = {}): Promise<WorkerOutcome> {
  if (options.signal?.aborted) return "idle";
  const leaseMs = options.leaseMs ?? 30_000;
  const heartbeatMs = options.heartbeatMs ?? 5_000;
  if (!Number.isInteger(heartbeatMs) || heartbeatMs < 10 || heartbeatMs * 2 >= leaseMs) {
    throw new Error("Heartbeat interval must be positive and less than half the lease.");
  }
  const claimed = await claimWorkerBuild(pool, ownerId, leaseMs, options.capacity);
  if (!claimed) return "idle";
  const claim: WorkerClaim = claimed;
  const controller = new AbortController();
  function shutdown(): void { controller.abort(options.signal?.reason); }
  options.signal?.addEventListener("abort", shutdown, { once: true });
  if (options.signal?.aborted) shutdown();
  let stopRequested = false;
  let heartbeatPending: Promise<void> | null = null;
  let failure: unknown;
  let effectPending = false;
  let acceptingWork = true;
  let cleanupFailed = false;

  async function heartbeat(): Promise<void> {
    await adapter.heartbeat?.();
    const status = await heartbeatWorker(pool, claim, leaseMs);
    if (status.stopRequested) {
      stopRequested = true;
      controller.abort(new Error("Stop requested."));
    }
  }

  const timer = setInterval(function renew() {
    if (heartbeatPending) return;
    heartbeatPending = heartbeat().catch(function lost(cause: unknown) {
      failure = cause;
      controller.abort(cause);
    }).finally(function settled() { heartbeatPending = null; });
  }, heartbeatMs);

  const context: WorkerContext = {
    claim,
    signal: controller.signal,
    async checkpoint(hash) {
      controller.signal.throwIfAborted();
      if (!acceptingWork) throw new Error("Worker adapter already returned.");
      if (effectPending) throw new Error("Cannot checkpoint while an effect is running.");
      await recordWorkerCheckpoint(pool, claim, hash);
    },
    async effect(key, kind, dispatch) {
      controller.signal.throwIfAborted();
      if (!acceptingWork) throw new Error("Worker adapter already returned.");
      if (effectPending) throw new Error("A worker executes one bounded effect at a time.");
      effectPending = true;
      try {
        const completed = await readCompletedWorkerEffect(pool, claim, key, kind);
        if (completed) return completed;
        await beginWorkerEffect(pool, claim, key, kind);
        controller.signal.throwIfAborted();
        if (!acceptingWork) throw new Error("Worker adapter returned before dispatch.");
        const receipt = await dispatch(controller.signal);
        await completeWorkerEffect(pool, claim, key, receipt);
        controller.signal.throwIfAborted();
        return receipt;
      } finally {
        effectPending = false;
      }
    },
  };

  try {
    options.onClaim?.();
    await heartbeat();
    controller.signal.throwIfAborted();
    await adapter.run(context);
  } catch (cause) {
    failure = cause;
  }
  acceptingWork = false;
  if (effectPending) {
    failure = new Error("Worker adapter returned with unfinished work.");
    controller.abort(failure);
  }
  try {
    await adapter.cleanup(claim);
  } catch (cause) {
    failure = cause;
    cleanupFailed = true;
  }
  clearInterval(timer);
  await heartbeatPending;

  try {
    // Re-read Stop after cleanup, so a quiet adapter has the same completion
    // race semantics as an adapter that was actively reporting progress.
    await heartbeat();
    if (cleanupFailed) throw failure;
    if (failure && !stopRequested) {
      // A daemon shutdown is not a user cancellation. Retain the last clean
      // checkpoint; the replacement owner may resume only after validation.
      if (options.signal?.aborted) throw failure;
      if (adapter.pauseAfterCleanup && await adapter.pauseAfterCleanup(claim, failure)) return "paused_budget";
      if (adapter.failAfterCleanup && await adapter.failAfterCleanup(claim, failure)) return "completed";
      throw failure;
    }
    if (adapter.settle) await adapter.settle(claim, stopRequested);
    else await finishWorkerBuild(pool, claim, stopRequested);
    return stopRequested ? "stopped" : "completed";
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : "Worker execution needs reconciliation.";
    await pauseWorkerBuild(pool, claim, reason);
    return "recovery_required";
  } finally {
    options.signal?.removeEventListener("abort", shutdown);
  }
}
