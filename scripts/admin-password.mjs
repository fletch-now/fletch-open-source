#!/usr/bin/env node
// Prints a fresh admin console password and the ADMIN_PASSWORD_HASH line for
// /etc/fletch/fletch.env. The format matches lib/admin/gate.ts: scrypt, N=32768,
// r=8, p=1, 64-byte key, salt and key base64url. Pass a password as the only
// argument to hash one you chose instead.
import { randomBytes, scryptSync } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function generate(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

const password = process.argv[2] ?? `${generate(6)}-${generate(6)}-${generate(6)}-${generate(6)}`;
const salt = randomBytes(16);
const key = scryptSync(password.normalize("NFKC"), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
console.log(`password: ${password}`);
console.log(`ADMIN_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`);
