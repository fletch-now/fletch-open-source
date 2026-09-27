import "server-only";
import { workerBuildsEnabled } from "@/lib/build/durable/routing";
import { logEvent } from "@/lib/log";
import { recoverInterruptedBuilds } from "@/lib/build/queue";
import { startBuildQueue } from "@/lib/build/runner";

export async function failOrphanedBuilds(): Promise<void> {
  for (const buildId of await recoverInterruptedBuilds()) {
    logEvent("build", { event: "orphan-swept", buildId });
  }
}

// This application has one Node web process. Start only after interrupted runs
// are accounted for; waiting builds remain queued and do not need a subscriber.
const state = globalThis as typeof globalThis & { __fletchBuildServices?: Promise<void> };

export function startBuildServices(): Promise<void> {
  if (workerBuildsEnabled()) return Promise.resolve();
  state.__fletchBuildServices ??= recoverAndStart();
  return state.__fletchBuildServices;
}

async function recoverAndStart(): Promise<void> {
  await failOrphanedBuilds();
  startBuildQueue();
}
