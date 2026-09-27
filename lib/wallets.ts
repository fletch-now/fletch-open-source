import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { walletAddress } from "@/lib/db/schema";

// A person's wallets change at sign-in and almost never otherwise, yet every
// request asked the database for them twice: once for the session's address
// and once for the admin check. A short in-process cache answers both from one
// read. A minute is long enough to cover a page's worth of requests and short
// enough that a wallet linked in Settings shows up on the next visit.

const TTL_MS = 60_000;

interface Cached {
  at: number;
  addresses: string[];
}

const cache = new Map<string, Cached>();

export async function walletsForUser(userId: string): Promise<string[]> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.addresses;
  }
  const rows = await db
    .select({ address: walletAddress.address })
    .from(walletAddress)
    .where(eq(walletAddress.userId, userId))
    .orderBy(desc(walletAddress.isPrimary), walletAddress.createdAt);
  const addresses = rows.map(function pick(row) {
    return row.address;
  });
  cache.set(userId, { at: Date.now(), addresses });
  return addresses;
}

export function forgetWallets(userId: string): void {
  cache.delete(userId);
}
