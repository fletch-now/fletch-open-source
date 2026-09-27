// Authentication for the v1 HTTP API: either a browser session (cookie, via
// better-auth) or an API key ("Authorization: Bearer flk_..."). Route handlers
// call authenticateV1 once and branch on whether it returned an actor or an
// error — never duplicate the header/session logic per route.

import { getSession } from "@/lib/dal";
import { API_KEY_SCOPES, touchApiKey, verifyApiKey, type ApiKeyScope } from "@/lib/auth/api-keys";
import { APP_URL } from "@/lib/config";
import { checkKeyRate, checkSessionApiRate, checkRegistryReadRate, clientIp } from "@/lib/ratelimit";

export type Scope = ApiKeyScope;

export interface V1Actor {
  userId: string;
  actorType: "user" | "api_key";
  actorId?: string;
  scopes: Scope[];
}

export interface V1Error {
  status: 401 | 403 | 429;
  error: string;
  // Set on a 429: how long the caller's window has left to run.
  retryAfterSeconds?: number;
}

export function isV1Error(value: V1Actor | V1Error): value is V1Error {
  return "status" in value;
}

// A browser session isn't scoped — it's the account owner acting directly —
// so it carries every scope an API key could otherwise be issued.
const SESSION_SCOPES: Scope[] = [...API_KEY_SCOPES];

// The session cookie is SameSite=Lax, which stops a cross-site POST but not one
// from a sibling subdomain such as the hosted apps. A browser names the
// request's site on every fetch, so a write it sends from anywhere but this
// origin is refused; a request with neither header is not a browser's.
const APP_ORIGIN = new URL(process.env.BETTER_AUTH_URL ?? APP_URL).origin;

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match ? match[1] : null;
}

function crossSiteWrite(request: Request): boolean {
  if (request.method === "GET" || request.method === "HEAD") {
    return false;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    return true;
  }
  const origin = request.headers.get("origin");
  return origin !== null && origin !== APP_ORIGIN;
}

export async function authenticateV1(request: Request, requiredScope: Scope): Promise<V1Actor | V1Error> {
  const token = bearerToken(request);

  if (token) {
    if (!token.startsWith("flk_")) {
      return { status: 401, error: "Invalid API key" };
    }
    const verified = await verifyApiKey(token);
    if (!verified) {
      return { status: 401, error: "Invalid or revoked API key" };
    }
    if (!verified.scopes.includes(requiredScope)) {
      return { status: 403, error: `Missing scope: ${requiredScope}` };
    }
    const rate = await checkKeyRate(verified.keyId);
    if (!rate.ok) {
      return { status: 429, error: rate.reason ?? "Rate limit reached", retryAfterSeconds: rate.retryAfterSeconds };
    }
    await touchApiKey(verified.keyId);
    return { userId: verified.userId, actorType: "api_key", actorId: verified.keyId, scopes: verified.scopes };
  }

  const session = await getSession();
  if (!session) {
    return { status: 401, error: "Sign in or provide an API key" };
  }
  if (crossSiteWrite(request)) {
    return { status: 403, error: "Cross-site request refused" };
  }
  const rate = await checkSessionApiRate(session.user.id);
  if (!rate.ok) return { status: 429, error: rate.reason ?? "Rate limit reached", retryAfterSeconds: rate.retryAfterSeconds };
  return { userId: session.user.id, actorType: "user", scopes: SESSION_SCOPES };
}

// requireScope is a thin guard for a v1 route that needs a second scope beyond
// the one authenticateV1 already checked (a route touching two resources).
export function requireScope(actor: V1Actor, scope: Scope): V1Error | null {
  if (!actor.scopes.includes(scope)) {
    return { status: 403, error: `Missing scope: ${scope}` };
  }
  return null;
}

export function json(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers });
}

// The headers a refusal owes its caller: a 401 names the scheme (RFC 6750), a
// 429 says when the window ends, so a client neither guesses nor retries blind.
export function errorHeaders(error: V1Error): Record<string, string> {
  if (error.status === 401) {
    return { "www-authenticate": 'Bearer realm="fletch"' };
  }
  if (error.status === 429 && error.retryAfterSeconds !== undefined) {
    return { "retry-after": String(error.retryAfterSeconds) };
  }
  return {};
}

export function errorJson(error: V1Error): Response {
  return json(error.status, { error: error.error }, errorHeaders(error));
}

// Registry reads accept anyone. A key or a session is used when present, so
// those callers keep their own budgets; otherwise the caller is an address with
// a per-minute limit. Nothing about an asset is private.
export async function authenticateRead(request: Request): Promise<V1Actor | V1Error | { anonymous: true }> {
  const hasBearer = request.headers.get("authorization") !== null;
  if (hasBearer || request.headers.get("cookie") !== null) {
    const actor = await authenticateV1(request, "registry:read");
    if (!isV1Error(actor) || actor.status === 429) {
      return actor;
    }
    // A key that fails to verify is answered, so a mistyped, rotated or
    // revoked key is seen rather than quietly read on the address budget. A
    // key without the read scope, or a stale cookie, reads as anyone does.
    if (actor.status === 401 && hasBearer) {
      return actor;
    }
  }
  const rate = await checkRegistryReadRate(clientIp(request.headers));
  if (!rate.ok) {
    return { status: 429, error: rate.reason ?? "Too many requests", retryAfterSeconds: rate.retryAfterSeconds };
  }
  return { anonymous: true };
}

export function readDenied(result: Awaited<ReturnType<typeof authenticateRead>>): V1Error | null {
  if ("anonymous" in result) {
    return null;
  }
  return isV1Error(result) ? result : null;
}
