import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexTokens } from "@/lib/db/schema";
import { readTokenProbe } from "@/lib/watch/token-meta";
import { trustForToken, type TokenTrust } from "@/lib/registry/trust";

export async function resolveToken(chainId: number, address: string): Promise<TokenTrust> {
  const trust = await trustForToken(chainId, address);
  if (trust.source === "registry" || (trust.readAt && Date.now() - trust.readAt.getTime() < 300_000)) {
    return trust;
  }
  const probe = await readTokenProbe(chainId, address);
  const facts = {
    name: probe.name, symbol: probe.symbol, decimals: probe.decimals,
    bytecodePresent: probe.bytecodePresent, checkedAt: new Date(),
    error: probe.bytecodePresent === true && probe.decimals !== null ? null : "could not confirm bytecode and decimals",
  };
  const id = `${chainId}:${address.toLowerCase()}`;
  if (trust.source === "discovered") {
    await db.update(dexTokens).set(facts).where(eq(dexTokens.id, id));
  } else {
    await db.insert(dexTokens).values({
      id, chainId, address: address.toLowerCase(), source: "user_submitted",
      firstSeenBlock: probe.blockNumber, ...facts,
    }).onConflictDoNothing();
  }
  return trustForToken(chainId, address);
}
