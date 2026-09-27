import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { decryptSecret } from "@/lib/telegram/secret";

function key(): Buffer {
  const configured = process.env.MODEL_CREDENTIAL_KEY;
  if (!configured || configured.length < 32) throw new Error("Hosted model storage requires MODEL_CREDENTIAL_KEY (at least 32 characters).");
  return createHash("sha256").update(configured).digest();
}
export function encryptCredential(plain: string, identity: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(identity));
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptCredential(stored: string, identity: string): string {
  // Existing ciphertext remains readable for migration; new writes use a dedicated key and bound identity.
  if (!stored.startsWith("v1.")) return decryptSecret(stored);
  const [, iv, tag, encrypted] = stored.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(identity));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
