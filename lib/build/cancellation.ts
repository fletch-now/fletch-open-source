import { AsyncLocalStorage } from "node:async_hooks";

export const STOP_REQUESTED = "Stopped by you. Source files were retained. Any Fletch build debit is refunded; provider usage may still be billed. Already broadcast transactions cannot be undone.";

// The signal follows the server-owned run, independently of its SSE subscribers.
const processState = globalThis as typeof globalThis & { __fletchBuildCancellation?: AsyncLocalStorage<AbortSignal> };
const cancellation = processState.__fletchBuildCancellation ??= new AsyncLocalStorage<AbortSignal>();

export function withBuildCancellation<T>(signal: AbortSignal, work: () => T): T {
  return cancellation.run(signal, work);
}

export function buildSignal(other?: AbortSignal): AbortSignal | undefined {
  const signal = cancellation.getStore();
  if (signal && other) return AbortSignal.any([signal, other]);
  return signal ?? other;
}

export function checkBuildCancellation(): void {
  cancellation.getStore()?.throwIfAborted();
}
