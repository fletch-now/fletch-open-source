import type { WorkerOutcome } from "./worker";
import { parseCapacity } from "../capacity";

export interface WorkerScheduler {
  active: number;
  drain: () => void;
  fill: (capacity: number) => Promise<void>;
  settled: () => Promise<void>;
}

// Wait only for the claim decision. Accepted jobs keep running while the next
// claim is considered; an empty queue causes one failed claim per poll.
export function createWorkerScheduler(run: (claimed: () => void) => Promise<WorkerOutcome>, failed: (cause: unknown) => void): WorkerScheduler {
  const active = new Set<Promise<void>>();
  let filling: Promise<void> | null = null;
  let draining = false;

  async function fill(capacity: number): Promise<void> {
    while (!draining && active.size < capacity) {
      let resolveClaim!: (claimed: boolean) => void;
      const decision = new Promise<boolean>(function ready(resolve) { resolveClaim = resolve; });
      const work = Promise.resolve().then(function start() {
        return run(function claimed() { resolveClaim(true); });
      }).then(function finished() {
        resolveClaim(false);
      }).catch(function report(cause: unknown) {
        resolveClaim(false);
        failed(cause);
      }).finally(function release() { active.delete(work); });
      active.add(work);
      if (!await decision) break;
    }
  }

  return {
    get active() { return active.size; },
    drain() { draining = true; },
    async fill(capacity) {
      parseCapacity(capacity);
      if (!filling) filling = fill(capacity).finally(function finished() { filling = null; });
      await filling;
    },
    async settled() { await filling; await Promise.all(active); },
  };
}
