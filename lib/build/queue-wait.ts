import { setTimeout as delay } from "node:timers/promises";

export async function waitForQueuePoll(ms: number, signal: AbortSignal): Promise<void> {
  try {
    // Node removes its abort listener after either timeout or cancellation.
    await delay(ms, undefined, { signal });
  } catch (error) {
    if (!(signal.aborted && error instanceof Error && error.name === "AbortError")) throw error;
  }
}
