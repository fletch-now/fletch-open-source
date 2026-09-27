// The responses of the public registry routes. Every answer carries CORS
// headers, because a dapp or dashboard on another origin is exactly who reads
// them, and there is nothing credentialed to protect: the routes accept anyone.
// A conditional GET is answered with a 304 when the body's hash matches, so an
// agent that polls with If-None-Match pays no bytes when nothing changed.
// `maxAge` follows the job that writes the data.

import { createHash } from "node:crypto";
import { errorHeaders, json, type V1Error } from "@/lib/auth/v1";

export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "etag, cache-control, retry-after",
};

export function cachedJson(request: Request, body: Record<string, unknown>, maxAgeSeconds: number, staleWhileRevalidate = true): Response {
  const text = JSON.stringify(body);
  const etag = `W/"${createHash("sha1").update(text).digest("base64url").slice(0, 27)}"`;
  const headers = {
    ...CORS_HEADERS,
    etag,
    "cache-control": staleWhileRevalidate
      ? `public, max-age=${maxAgeSeconds}, stale-while-revalidate=${maxAgeSeconds}`
      : `public, max-age=${maxAgeSeconds}, must-revalidate`,
    vary: "Authorization",
  };
  const match = request.headers.get("if-none-match");
  if (match && match.split(",").some((candidate) => candidate.trim() === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(text, { status: 200, headers: { ...headers, "content-type": "application/json" } });
}

// A 400 or 404 from a public route, readable cross-origin like the 200.
export function publicJson(status: number, body: Record<string, unknown>): Response {
  return json(status, body, CORS_HEADERS);
}

export function publicDenied(denied: V1Error): Response {
  return json(denied.status, { error: denied.error }, { ...CORS_HEADERS, ...errorHeaders(denied) });
}

// The preflight a browser sends before a GET that carries If-None-Match or a
// key. No credentials are allowed, so the wildcard origin is safe to cache.
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "authorization, if-none-match",
      "access-control-max-age": "86400",
    },
  });
}
