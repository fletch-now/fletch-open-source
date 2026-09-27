import "server-only";
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { adminSessions } from "@/lib/db/schema";
import { ADMIN_GATE_COOKIE, COOKIE_SECURE } from "@/lib/auth-cookie";

// The admin console sits behind an operator password, typed once per sitting.
// No wallet is involved for now; a TOTP factor is planned to join the password,
// and this file is where it goes.
//
// The password is never stored. ADMIN_PASSWORD_HASH holds an scrypt hash in
// the form `scrypt$<salt>$<hash>` (base64url), produced by
// scripts/admin-password.mjs. Passing the gate sets a signed cookie carrying
// its own expiry and a random nonce, good for twelve hours or until Lock.

const SCRYPT_KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer, keyBytes: number): Promise<Buffer> {
  return new Promise(function derive(resolve, reject) {
    scryptCallback(password, salt, keyBytes, SCRYPT_OPTIONS, function done(error, key) {
      if (error) {
        reject(error);
        return;
      }
      resolve(key);
    });
  });
}
const UNLOCK_TTL_SECONDS = 12 * 60 * 60;

function gateSecret(): string {
  const secret = process.env.ADMIN_GATE_SECRET ?? process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("ADMIN_GATE_SECRET or BETTER_AUTH_SECRET must be set");
  }
  return secret;
}

export function adminPasswordConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD_HASH);
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEY_BYTES);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  const stored = process.env.ADMIN_PASSWORD_HASH ?? "";
  const [scheme, saltText, hashText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !hashText) {
    return false;
  }
  const salt = Buffer.from(saltText, "base64url");
  const expected = Buffer.from(hashText, "base64url");
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function sign(nonce: string, expires: number): string {
  return createHmac("sha256", gateSecret()).update(`${nonce}.${expires}`).digest("base64url");
}

export async function unlockAdmin(): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + UNLOCK_TTL_SECONDS;
  const nonce = randomBytes(16).toString("base64url");
  // The nonce is recorded so Lock can revoke it: a cookie copied from a proxy
  // log or a shared machine dies with the session, not with its expiry.
  await db.insert(adminSessions).values({ nonce, expiresAt: new Date(expires * 1000) });
  const jar = await cookies();
  jar.set(ADMIN_GATE_COOKIE, `${expires}.${nonce}.${sign(nonce, expires)}`, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "strict",
    path: "/",
    maxAge: UNLOCK_TTL_SECONDS,
  });
}

export async function lockAdmin(): Promise<void> {
  const jar = await cookies();
  const nonce = jar.get(ADMIN_GATE_COOKIE)?.value.split(".")[1];
  if (nonce) {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.nonce, nonce));
  }
  jar.delete(ADMIN_GATE_COOKIE);
}

export async function hasAdminUnlock(): Promise<boolean> {
  const jar = await cookies();
  const value = jar.get(ADMIN_GATE_COOKIE)?.value;
  if (!value) {
    return false;
  }
  const [expiresText, nonce, signature] = value.split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000) || !nonce || !signature) {
    return false;
  }
  const expected = Buffer.from(sign(nonce, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return false;
  }
  const rows = await db.select({ revokedAt: adminSessions.revokedAt }).from(adminSessions).where(eq(adminSessions.nonce, nonce)).limit(1);
  return rows[0] !== undefined && rows[0].revokedAt === null;
}
