import type { JobName } from "./cadence";
import { failedRegistryJobDelay, successfulRegistryJobDelay } from "./job-delay";

export interface RegistryJob {
  name: JobName;
  everyMs: number;
  run: () => Promise<unknown | null>;
}

// These jobs retain a session advisory lock while their RPC accounting and
// other queries need another connection from the same pool.
const CONNECTION_HOLDING_JOBS = new Set<JobName>([
  "dex-state", "priority-universe", "priority-holders", "explorer-scouting", "lookalikes",
]);

interface WaitingJob {
  job: RegistryJob;
  dueAt: number;
}

export interface RegistryJobScheduler {
  readonly running: string[];
  readonly queued: string[];
  schedule: (job: RegistryJob, delayMs: number) => void;
  stop: () => void;
}

export function createRegistryJobScheduler(maxConnections: number, onError: (job: JobName, cause: unknown) => void): RegistryJobScheduler {
  if (!Number.isInteger(maxConnections) || maxConnections < 2) throw new Error("Registry needs at least two database connections for lock ownership and nested queries.");
  const limit = Math.min(3, maxConnections - 1);
  // Every job uses the database, even when it does not hold an advisory lock.
  // Previously only lock-owning jobs were admitted through a queue, leaving
  // the other jobs unbounded. A restart could therefore start dozens of scans
  // at once and exhaust the database pool before the web app could connect.
  // Keep one connection in reserve for health and request traffic. A two
  // connection test pool has one execution slot; larger pools allow at most
  // four jobs in flight, including lightweight heartbeat work.
  const runLimit = maxConnections <= 2 ? 1 : Math.min(4, maxConnections);
  const timers = new Map<JobName, NodeJS.Timeout>();
  const running = new Set<JobName>();
  const failures = new Map<JobName, number>();
  const queued: WaitingJob[] = [];
  let activeHolders = 0;
  let stopping = false;
  let preferState = true;

  function admit(): void {
    while (!stopping && running.size < runLimit && queued.length) {
      let index = -1;
      if (preferState && activeHolders < limit) {
        index = queued.findIndex(function isState(entry) { return entry.job.name === "dex-state"; });
      }
      if (index < 0) {
        index = queued.findIndex(function fits(entry) {
          return !CONNECTION_HOLDING_JOBS.has(entry.job.name) || activeHolders < limit;
        });
      }
      if (index < 0) break;
      const [entry] = queued.splice(index, 1);
      // A state refresh can move ahead once, then the oldest waiter gets its
      // turn. Repeated state requests cannot starve catalog or holder work.
      preferState = entry.job.name !== "dex-state";
      void run(entry);
    }
  }

  async function run({ job, dueAt }: WaitingJob): Promise<void> {
    const holdsConnection = CONNECTION_HOLDING_JOBS.has(job.name);
    if (holdsConnection) activeHolders++;
    running.add(job.name);
    let failed = false;
    try {
      failed = (await job.run()) === null;
    } catch (cause) {
      failed = true;
      onError(job.name, cause);
    } finally {
      running.delete(job.name);
      if (holdsConnection) activeHolders--;
      admit();
    }
    const streak = failed ? (failures.get(job.name) ?? 0) + 1 : 0;
    failures.set(job.name, streak);
    const delay = failed
      ? failedRegistryJobDelay(job.name, job.everyMs, streak)
      : successfulRegistryJobDelay(job.name, job.everyMs, Date.now() - dueAt);
    schedule(job, delay);
  }

  function schedule(job: RegistryJob, delayMs: number): void {
    if (stopping || running.has(job.name) || queued.some(function same(entry) { return entry.job.name === job.name; })) return;
    const previous = timers.get(job.name);
    if (previous) clearTimeout(previous);
    timers.set(job.name, setTimeout(function due() {
      timers.delete(job.name);
      if (stopping) return;
      const entry = { job, dueAt: Date.now() };
      queued.push(entry);
      admit();
    }, delayMs));
  }

  return {
    get running() { return [...running]; },
    get queued() { return queued.map(function name(entry) { return entry.job.name; }); },
    schedule,
    stop(): void {
      stopping = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      queued.length = 0;
    },
  };
}
