import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Secrets a person hands Fletch (their own Telegram bot token) are stored
// encrypted at rest with AES-256-GCM. The key is derived from
// TELEGRAM_TOKEN_KEY, or from BETTER_AUTH_SECRET when that is not set, so a
// database dump alone never yields a usable token. No "server-only": the watch
// daemon decrypts at send time.

function key(): Buffer {
  const source = process.env.TELEGRAM_TOKEN_KEY || process.env.BETTER_AUTH_SECRET || "";
  if (!source) {
    throw new Error("No key to encrypt secrets with: set TELEGRAM_TOKEN_KEY or BETTER_AUTH_SECRET");
  }
  return createHash("sha256").update(source).digest();
}

// iv.tag.ciphertext, each base64url, so the row is one text column.
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(stored: string): string {
  const [iv, tag, encrypted] = stored.split(".").map((part) => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}
