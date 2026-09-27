// A short process-local cache for public reads. Values retain Dates and Maps;
// simultaneous requests share one promise, and failed reads are never retained.
export function publicReadCache<T>(ttlMs: number, capacity = 32): (key: string, read: () => Promise<T>) => Promise<T> {
  const entries = new Map<string, { expires: number; value: Promise<T> }>();
  return function cached(key, read) {
    const now = Date.now();
    const existing = entries.get(key);
    if (existing && existing.expires > now) {
      return existing.value;
    }
    entries.delete(key);
    for (const [storedKey, entry] of entries) {
      if (entry.expires <= now) entries.delete(storedKey);
    }
    if (entries.size >= capacity) {
      entries.delete(entries.keys().next().value!);
    }
    const value = Promise.resolve().then(read);
    entries.set(key, { expires: now + ttlMs, value });
    void value.catch(function failed() {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    return value;
  };
}
