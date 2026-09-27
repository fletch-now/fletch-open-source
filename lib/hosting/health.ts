import "server-only";

// Whether a hosted site answers right now. Asked from the server at render
// time, with a short deadline, so a page can say "answered 200 in 84 ms" or
// "not answering" instead of assuming that a published site is still up.

export interface SiteHealth {
  ok: boolean;
  status: number | null;
  ms: number;
}

const DEADLINE_MS = 2_500;

export async function checkSite(url: string): Promise<SiteHealth> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(function expire() {
    controller.abort();
  }, DEADLINE_MS);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", redirect: "manual", signal: controller.signal });
    return { ok: response.status >= 200 && response.status < 400, status: response.status, ms: Date.now() - started };
  } catch {
    return { ok: false, status: null, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Sites checked together, a few at a time, so a list of projects never fires
// more than a handful of requests at once.
export async function checkSites(urls: string[]): Promise<Map<string, SiteHealth>> {
  const results = new Map<string, SiteHealth>();
  const unique = Array.from(new Set(urls));
  const batchSize = 6;
  for (let start = 0; start < unique.length; start += batchSize) {
    const batch = unique.slice(start, start + batchSize);
    const checked = await Promise.all(batch.map(checkSite));
    batch.forEach(function record(url, index) {
      results.set(url, checked[index]);
    });
  }
  return results;
}

export function describeHealth(health: SiteHealth | undefined): string {
  if (!health) {
    return "not checked";
  }
  if (health.ok) {
    return `answered ${health.status} in ${health.ms} ms`;
  }
  if (health.status === null) {
    return "not answering";
  }
  return `answered ${health.status}`;
}
