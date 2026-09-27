import { registerWorkerContainer, releaseWorkerContainer } from "@/lib/build/durable/execution";
import { execFile, type ChildProcess, type SpawnOptions } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { buildSignal, checkBuildCancellation } from "@/lib/build/cancellation";

function removeContainerOnce(name: string): Promise<void> {
  return new Promise(function remove(resolve, reject) {
    execFile("docker", ["rm", "--force", name], { timeout: 10_000 }, function removed(error, _stdout, stderr) {
      if (error && !stderr.includes("No such container")) reject(error);
      else resolve();
    });
  });
}

export class BuildCleanupError extends Error {
  constructor(readonly retry: () => Promise<void>) {
    super("Sandbox cleanup has not been confirmed. The build remains reserved while cleanup is retried.");
    this.name = "BuildCleanupError";
  }
}

async function removeContainer(name: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await removeContainerOnce(name);
      return;
    } catch {
      if (attempt < 2) await delay(250);
    }
  }
  throw new BuildCleanupError(() => removeContainer(name));
}

export interface ProcessCancellation {
  stop: () => void;
  dispose: () => Promise<void>;
}

// Creation cannot be aborted midway: the daemon might still create a container
// after its client disappears. Await its ID, then either remove it or start it.
export async function prepareBuildProcess(command: string, args: string[], options: Pick<SpawnOptions, "cwd" | "env">, container?: string): Promise<string[]> {
  checkBuildCancellation();
  if (!container) return args;
  await registerWorkerContainer(container);
  try {
    await new Promise<void>(function create(resolve, reject) {
      execFile(command, ["create", ...args.slice(1)], { ...options, timeout: 30_000 }, function created(error) {
        if (error) reject(error);
        else resolve();
      });
    });
    checkBuildCancellation();
    return ["start", "--attach", container];
  } catch (cause) {
    await removeContainer(container);
    throw cause;
  }
}

// The attached Docker client and its already-created container have separate lifetimes.
export function watchBuildProcess(child: ChildProcess, container?: string, onStop?: () => void, signal = buildSignal()): ProcessCancellation {
  let stopping: Promise<void> | undefined;
  function stop(): void {
    if (stopping) return;
    onStop?.();
    child.kill("SIGKILL");
    stopping = (async function remove(): Promise<void> {
      if (!container) return;
      await removeContainer(container);
    })();
    // dispose awaits the same promise, including any cleanup failure.
    void stopping.catch(function observed() {});
  }
  signal?.addEventListener("abort", stop, { once: true });
  if (signal?.aborted) stop();
  return {
    stop,
    async dispose(): Promise<void> {
      signal?.removeEventListener("abort", stop);
      await stopping;
      if (container) await releaseWorkerContainer(container);
    },
  };
}
