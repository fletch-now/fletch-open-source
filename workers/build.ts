import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import "./server-runtime";
import { validateWorkerEnvironment } from "../lib/build/durable/config";
import { realpath } from "node:fs/promises";

for (const file of ["/etc/fletch/fletch.env", ".env.local"]) {
  if (existsSync(file)) loadEnv({ path: file });
}

async function main(): Promise<void> {
  validateWorkerEnvironment(process.env);
  // Resolve existing provisioned directories to reject hidden links into a
  // workspace or temporary storage before any build or proxy can start.
  validateWorkerEnvironment({ ...process.env,
    FORGE_WORKSPACE_ROOT: await realpath(process.env.FORGE_WORKSPACE_ROOT!),
    FORGE_CHECKPOINT_ROOT: await realpath(process.env.FORGE_CHECKPOINT_ROOT!),
  });
  const { readBuildCapacity, validatedWorkerCapacity } = await import("@/lib/build/capacity");
  const { createWorkerScheduler } = await import("@/lib/build/durable/scheduler");
  const { runBuildWorkerOnce, reconcileLostBuildWorkers } = await import("@/lib/build/durable/runner");
  const { writeWorkerHealth, storageAdmissionReady } = await import("@/lib/build/worker-health");
  const { runPublicationOnce } = await import("@/lib/hosting/publications");
  let publication: Promise<void> | null = null;
  const { close, pool } = await import("@/lib/db");
  const { closeCredentialProxy } = await import("@/lib/agent/credential-proxy");
  const { logEvent } = await import("@/lib/log");
  const shutdown = new AbortController();
  const ownerId = `build-worker:${randomUUID()}`;
  const scheduler = createWorkerScheduler(function run(onClaim) {
    return runBuildWorkerOnce(ownerId, { signal: shutdown.signal, onClaim });
  }, function failed(cause) {
    logEvent("build-worker", { event: "iteration-failed", message: cause instanceof Error ? cause.message : String(cause) });
  });
  let draining = false;
  function drain(): void {
    draining = true;
    scheduler.drain();
    logEvent("build-worker", { event: "draining", ownerId, active: scheduler.active });
  }
  process.once("SIGUSR2", drain);
  function stop(): void { scheduler.drain(); shutdown.abort(new Error("Worker shutdown; retain accepted work for reconciliation.")); }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    await validatedWorkerCapacity(pool);
    while (!shutdown.signal.aborted && !draining) {
      try {
        await reconcileLostBuildWorkers();
        const storageReady = await storageAdmissionReady(process.env.FORGE_WORKSPACE_ROOT!);
        if (storageReady) await scheduler.fill(await readBuildCapacity(pool));
        if (!publication) {
          publication = runPublicationOnce(shutdown.signal, pool).catch(function failed(cause) {
            logEvent("hosting", { event: "publisher-iteration-failed", message: cause instanceof Error ? cause.message : "Publication error" });
          }).finally(function settled() { publication = null; });
        }
        await writeWorkerHealth(pool, ownerId, storageReady, scheduler.active);
      } catch (cause) {
        await writeWorkerHealth(pool, ownerId, false, scheduler.active).catch(function unavailable() {});
        logEvent("build-worker", { event: "reconciliation-failed", message: cause instanceof Error ? cause.message : String(cause) });
      }
      await delay(1000, undefined, { signal: shutdown.signal }).catch(function interrupted() {});
    }
    await scheduler.settled();
    await publication;
  } finally {
    shutdown.abort();
    await publication;
    await closeCredentialProxy();
    await close();
  }
}

void main().catch(function failed(cause: unknown) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
