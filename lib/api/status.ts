// The body of GET /api/v1/chains/:chainId/status and its alias /api/v1/status:
// whether the registry is live. Always 200; the verdict is in the body, so a
// stale registry is a fact the caller reads rather than an error it retries.

import { authenticateRead, readDenied } from "@/lib/auth/v1";
import { cachedJson, publicDenied, publicJson } from "@/lib/api/etag";
import { RH_MAINNET_ID } from "@/lib/config";
import { freshness, type Freshness } from "@/lib/registry/authority/freshness";
import { publicFreshness } from "@/lib/registry/authority/shape";

// The fastest jobs run every ten seconds; a longer cache would hide a
// daemon that stopped between two polls.
const STATUS_MAX_AGE_SECONDS = 10;

// One reading serves every caller inside the cache window. A reading is some
// forty queries, and the ages in it are measured from its own clock, so the
// body is byte-identical for the whole window and a conditional GET can 304.
// Concurrent callers share the in-flight promise; a failed reading is dropped
// so the next call retries.
let cached: { at: number; reading: Promise<Freshness> } | null = null;

function freshnessCached(chainId: number): Promise<Freshness> {
  if (cached && Date.now() - cached.at < STATUS_MAX_AGE_SECONDS * 1000) {
    return cached.reading;
  }
  const reading = freshness(chainId);
  cached = { at: Date.now(), reading };
  reading.catch(function forget() {
    cached = null;
  });
  return reading;
}

export async function statusResponse(request: Request, chainId: number): Promise<Response> {
  const denied = readDenied(await authenticateRead(request));
  if (denied) {
    return publicDenied(denied);
  }
  if (chainId !== RH_MAINNET_ID) {
    return publicJson(404, { error: "Unknown chain" });
  }
  return cachedJson(request, publicFreshness(await freshnessCached(chainId)), STATUS_MAX_AGE_SECONDS);
}
