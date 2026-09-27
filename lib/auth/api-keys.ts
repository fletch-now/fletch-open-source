// API keys for v1 (spec ch. 0.5). A key is shown once at creation; only its
// SHA-256 hash is ever stored, so a compromised database cannot be replayed as
// a bearer token. See lib/auth/v1.ts for how a key authenticates a request.
//
// No "server-only": app/api/keys/* route handlers import this, and nothing here
// depends on next/* or React, so it stays safe to import from a script if needed.

import { randomBytes, createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { apiKeys, user } from "@/lib/db/schema";

import { API_KEY_SCOPES, isApiKeyScope, type ApiKeyScope } from "@/lib/auth/scopes";

export { API_KEY_SCOPES, isApiKeyScope, type ApiKeyScope };

const TOKEN_PREFIX = "flk_";

// base64url encodes 3 bytes -> 4 chars with no padding, so 24 bytes is exactly
// 32 chars — same construction as lib/telegram/link.ts's link tokens.
function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(24).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface CreatedApiKey {
  id: string;
  token: string;
  prefix: string;
}

export async function createApiKey(userId: string, name: string, scopes: ApiKeyScope[]): Promise<CreatedApiKey> {
  const token = generateToken();
  const id = `key_${randomUUID()}`;
  const prefix = token.slice(0, 12);
  await db.insert(apiKeys).values({
    id,
    userId,
    name,
    prefix,
    hash: hashToken(token),
    scopes,
  });
  return { id, token, prefix };
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// Never selects `hash` — the point of hashing at creation is that the plaintext
// token is the only thing that can authenticate, and the hash never leaves here.
export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const rows = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scopes: apiKeys.scopes,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, userId));
  return rows.map(function toSummary(row) {
    return { ...row, scopes: row.scopes as ApiKeyScope[] };
  });
}

export class ApiKeyNotFoundError extends Error {
  constructor(message = "API key not found") {
    super(message);
    this.name = "ApiKeyNotFoundError";
  }
}

export async function revokeApiKey(userId: string, id: string): Promise<void> {
  const updated = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id });
  if (updated.length === 0) {
    throw new ApiKeyNotFoundError();
  }
}

export interface VerifiedApiKey {
  userId: string;
  keyId: string;
  scopes: ApiKeyScope[];
}

export async function verifyApiKey(token: string): Promise<VerifiedApiKey | null> {
  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scopes: apiKeys.scopes,
      revokedAt: apiKeys.revokedAt,
      banned: user.banned,
    })
    .from(apiKeys)
    .innerJoin(user, eq(user.id, apiKeys.userId))
    .where(eq(apiKeys.hash, hashToken(token)))
    .limit(1);
  const row = rows[0];
  // A banned account is signed out everywhere, its keys included.
  if (!row || row.revokedAt || row.banned) {
    return null;
  }
  return { userId: row.userId, keyId: row.id, scopes: row.scopes as ApiKeyScope[] };
}

// Written after the key has passed its scope and rate checks, and at most once
// a minute per key: a looping client over its budget should cost one read, not
// a row rewrite per request. The Settings page loses at most a minute.
const TOUCH_INTERVAL_MS = 60_000;

export async function touchApiKey(keyId: string): Promise<void> {
  const now = new Date();
  await db
    .update(apiKeys)
    .set({ lastUsedAt: now })
    .where(and(eq(apiKeys.id, keyId), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, new Date(now.getTime() - TOUCH_INTERVAL_MS)))));
}
