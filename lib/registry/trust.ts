import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dexTokens, lookalikeTokens, registryAssets } from "@/lib/db/schema";
import { registryTokenFacts, collidesWith, trustVerdictWith, type TokenFacts, type TrustVerdict, type Verified } from "@/lib/registry/trust-rules";

// No "server-only": the watch daemon reads this from a plain tsx process, the
// same way it reads lib/watch/create.ts.
//
// The one place a token's trust level is decided. Every surface — the markets
// table, /api/v1/tokens, the watch form, the alert formatter — asks this and
// renders the answer; none of them carries a second rule.

export interface TokenTrust extends TrustVerdict {
  chainId: number;
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  // Where the facts came from: Robinhood's list, or the token's own contract.
  source: "registry" | "discovered" | "none";
  firstSeenAt: Date | null;
  readAt: Date | null;
}

export interface VerifiedAsset extends Verified {
  id: string;
  assetType: string;
  decimals: number;
}

export interface PoolTokenTrust extends TrustVerdict {
  address: string;
}

export async function trustForPools(
  chainId: number,
  pools: Array<{ id: string; assetId: string | null; tokenAddress: string | null }>,
  assets: Array<{ id: string; address: string }>,
): Promise<Map<string, PoolTokenTrust>> {
  const listed = new Map(assets.map((asset) => [asset.id, asset.address.toLowerCase()]));
  const addresses = new Map<string, string>();
  for (const pool of pools) {
    const address = pool.assetId ? listed.get(pool.assetId) : pool.tokenAddress?.toLowerCase();
    if (address) addresses.set(pool.id, address);
  }
  const verdicts = await trustForTokens(chainId, [...addresses.values()]);
  const result = new Map<string, PoolTokenTrust>();
  for (const [id, address] of addresses) {
    const verdict = verdicts.get(address);
    if (verdict) result.set(id, { ...verdict, address });
  }
  return result;
}

// Every asset the registry has confirmed against the chain, as the folded
// index a lookalike is measured against. A listing Fletch has not confirmed
// yet is not something to impersonate, so it is not in here. The DEX token
// reader folds against this same list, so what it records as an impersonator
// and what this file calls one cannot drift apart.
export async function verifiedAssetIndex(chainId: number): Promise<VerifiedAsset[]> {
  return db
    .select({ id: registryAssets.id, symbol: registryAssets.symbol, name: registryAssets.name, address: registryAssets.address, assetType: registryAssets.assetType, decimals: registryAssets.decimals })
    .from(registryAssets)
    .where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active"), isNotNull(registryAssets.verifiedAt),
      sql`upper(${registryAssets.onchainSymbol}) = upper(${registryAssets.symbol})`,
      eq(registryAssets.onchainDecimals, registryAssets.decimals)));
}

function factsFromDiscovered(row: typeof dexTokens.$inferSelect): TokenFacts {
  return {
    inRegistry: false,
    registryConfirmed: false,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    bytecodePresent: row.bytecodePresent,
  };
}

const UNREAD: TokenFacts = { inRegistry: false, registryConfirmed: false, symbol: null, name: null, decimals: null, bytecodePresent: null };

// Historical beacon-based classifications remain collision evidence. They
// never exempt an unlisted address from the shared identity verdict.
async function scannedCollisions(chainId: number, addresses: string[]): Promise<Map<string, Verified>> {
  const rows = await db
    .select({ address: lookalikeTokens.address, symbol: registryAssets.symbol, name: registryAssets.name, real: registryAssets.address })
    .from(lookalikeTokens)
    .innerJoin(registryAssets, eq(registryAssets.id, lookalikeTokens.matchesAssetId))
    .where(and(eq(lookalikeTokens.chainId, chainId), inArray(lookalikeTokens.address, addresses),
      eq(registryAssets.status, "active"), isNotNull(registryAssets.verifiedAt),
      sql`upper(${registryAssets.onchainSymbol}) = upper(${registryAssets.symbol})`,
      eq(registryAssets.onchainDecimals, registryAssets.decimals)));
  const out = new Map<string, Verified>();
  for (const row of rows) {
    out.set(row.address.toLowerCase(), { symbol: row.symbol, name: row.name, address: row.real });
  }
  return out;
}

// The folded symbol first, the scan second: either alone is enough to make a
// token a lookalike, and a registry address is never one.
function verdictFor(facts: TokenFacts, verified: readonly Verified[], scanned: Verified | undefined): TrustVerdict {
  const folded = collidesWith(facts, verified);
  const collision = folded ?? (facts.inRegistry ? null : (scanned ?? null));
  return trustVerdictWith(facts, collision);
}

export async function trustForToken(chainId: number, address: string): Promise<TokenTrust> {
  const wanted = address.toLowerCase();
  const [verified, assets, discovered, scanned] = await Promise.all([
    verifiedAssetIndex(chainId),
    db.select().from(registryAssets).where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.address, wanted))).limit(1),
    db.select().from(dexTokens).where(and(eq(dexTokens.chainId, chainId), eq(dexTokens.address, wanted))).limit(1),
    scannedCollisions(chainId, [wanted]),
  ]);
  const asset = assets[0];
  if (asset) {
    return {
      ...verdictFor(registryTokenFacts(asset), verified, undefined),
      chainId,
      address: wanted,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      source: "registry",
      firstSeenAt: asset.firstSeenAt,
      readAt: asset.metadataCheckedAt,
    };
  }
  const token = discovered[0];
  if (token) {
    return {
      ...verdictFor(factsFromDiscovered(token), verified, scanned.get(wanted)),
      chainId,
      address: wanted,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      source: "discovered",
      firstSeenAt: token.firstSeenAt,
      readAt: token.checkedAt,
    };
  }
  return { ...verdictFor(UNREAD, verified, scanned.get(wanted)), chainId, address: wanted, symbol: null, name: null, decimals: null, source: "none", firstSeenAt: null, readAt: null };
}

// The same verdict for a page of tokens, in two queries rather than two per
// row: the markets table asks for a hundred at a time.
export async function trustForTokens(chainId: number, addresses: string[]): Promise<Map<string, TrustVerdict>> {
  const wanted = [...new Set(addresses.map((address) => address.toLowerCase()))];
  const out = new Map<string, TrustVerdict>();
  if (wanted.length === 0) {
    return out;
  }
  const [verified, assets, discovered, scanned] = await Promise.all([
    verifiedAssetIndex(chainId),
    db.select().from(registryAssets).where(and(eq(registryAssets.chainId, chainId), inArray(registryAssets.address, wanted))),
    db.select().from(dexTokens).where(and(eq(dexTokens.chainId, chainId), inArray(dexTokens.address, wanted))),
    scannedCollisions(chainId, wanted),
  ]);
  const byAddress = new Map<string, TokenFacts>();
  for (const token of discovered) {
    byAddress.set(token.address.toLowerCase(), factsFromDiscovered(token));
  }
  for (const asset of assets) {
    byAddress.set(asset.address.toLowerCase(), registryTokenFacts(asset));
  }
  for (const address of wanted) {
    out.set(address, verdictFor(byAddress.get(address) ?? UNREAD, verified, scanned.get(address)));
  }
  return out;
}
