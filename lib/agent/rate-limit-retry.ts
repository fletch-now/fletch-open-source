import { setTimeout as delay } from "node:timers/promises";
import { ModelHttpError } from "./provider-transport";

interface RetryOptions {
  signal: AbortSignal;
  onWait: (milliseconds: number, attempt: number) => Promise<void>;
}

// A received 429 proves rejection. Lost responses and server errors may have
// generated billable output, so they never qualify for automatic replay.
export async function retryRateLimited<T>(dispatch: (attempt: number) => Promise<T>, options: RetryOptions): Promise<T> {
  let waited = 0;
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    try { return await dispatch(attempt); }
    catch (error) {
      if (!(error instanceof ModelHttpError) || error.status !== 429 || attempt >= 2) throw error;
      const requested = error.retryAfterSeconds === null ? [5000, 15000][attempt] : error.retryAfterSeconds * 1000;
      const milliseconds = requested + Math.floor(Math.random() * 1500);
      if (waited + milliseconds > 90_000) throw error;
      options.signal.throwIfAborted();
      await options.onWait(milliseconds, attempt + 1);
      await delay(milliseconds, undefined, { signal: options.signal });
      waited += milliseconds;
    }
  }
}
