import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetSearchCondition, assetSearchRank } from "@/lib/registry/search";
import { registryAssets } from "@/lib/db/schema";

export type RegistryAsset = typeof registryAssets.$inferSelect;

// Shared by every lookup below: the registry only exposes assets that are both
// on the requested chain and still active.
function activeOnChain(chainId: number): SQL | undefined {
  return and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active"));
}

// Published listings for the picker; arbitrary-address watchers resolve their
// targets separately and never add community tokens to this table.
export async function listAssets(chainId: number): Promise<RegistryAsset[]> {
  return db
    .select()
    .from(registryAssets)
    .where(activeOnChain(chainId))
    .orderBy(asc(registryAssets.symbol));
}

export async function getAssets(ids: string[]): Promise<RegistryAsset[]> {
  if (ids.length === 0) {
    return [];
  }
  return db.select().from(registryAssets).where(inArray(registryAssets.id, ids));
}

export async function getAsset(id: string): Promise<RegistryAsset | null> {
  const rows = await db.select().from(registryAssets).where(eq(registryAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

// The registry browser's order: stock tokens (what most people came for) first,
// then stablecoins, then wrapped native, then anything else — same grouping the
// table renders, so an empty query already reproduces the table top to bottom.
const ASSET_TYPE_ORDER = sql`case ${registryAssets.assetType}
  when 'stock_token' then 0
  when 'stablecoin' then 1
  when 'wrapped_native' then 2
  else 3
end`;

// Symbol/name substring match, case-insensitive. An empty query returns every
// active asset in table order, so the registry page can call this unconditionally.
export async function searchAssets(chainId: number, query: string): Promise<RegistryAsset[]> {
  const matchesQuery = assetSearchCondition(query);
  return db
    .select()
    .from(registryAssets)
    .where(and(activeOnChain(chainId), matchesQuery))
    .orderBy(...(matchesQuery ? [assetSearchRank(query)] : []), ASSET_TYPE_ORDER, asc(registryAssets.symbol));
}

export async function getAssetBySymbol(chainId: number, symbol: string): Promise<RegistryAsset | null> {
  const rows = await db
    .select()
    .from(registryAssets)
    .where(and(activeOnChain(chainId), sql`upper(${registryAssets.symbol}) = upper(${symbol})`))
    .limit(1);
  return rows[0] ?? null;
}
