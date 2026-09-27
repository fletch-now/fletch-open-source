// The assets a pipeline works on, and the upsert every pipeline writes through.
// The upsert is also where state transitions are noticed: it is the one place
// that sees both what stood before and what a job just read, so pause flags,
// halts, stale feeds, canonical checks and applied multipliers become
// authority events here and nowhere else.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryAssets, registryAssetState } from "@/lib/db/schema";
import { emitEvents, type AuthorityEventInput, type AuthorityEventKind } from "@/lib/registry/authority/events";

export interface TrackedAsset {
  id: string;
  chainId: number;
  address: `0x${string}`;
  symbol: string;
  name: string;
  assetType: string;
  decimals: number;
}

export async function activeAssets(chainId: number, assetType?: string): Promise<TrackedAsset[]> {
  const rows = await db
    .select({
      id: registryAssets.id,
      chainId: registryAssets.chainId,
      address: registryAssets.address,
      symbol: registryAssets.symbol,
      name: registryAssets.name,
      assetType: registryAssets.assetType,
      decimals: registryAssets.decimals,
    })
    .from(registryAssets)
    .where(
      assetType
        ? and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active"), eq(registryAssets.assetType, assetType))
        : and(eq(registryAssets.chainId, chainId), eq(registryAssets.status, "active")),
    );
  return rows.map(function shape(row) {
    return { ...row, address: row.address as `0x${string}` };
  });
}

type StateRow = typeof registryAssetState.$inferSelect;
type StatePatch = Partial<typeof registryAssetState.$inferInsert>;

interface FlagTransition {
  field: "tokenPaused" | "oraclePaused" | "apiTradingHalt" | "feedStale" | "canonical";
  whenTrue: AuthorityEventKind;
  whenFalse: AuthorityEventKind;
}

const FLAG_TRANSITIONS: readonly FlagTransition[] = [
  { field: "tokenPaused", whenTrue: "token.paused", whenFalse: "token.unpaused" },
  { field: "oraclePaused", whenTrue: "oracle.paused", whenFalse: "oracle.unpaused" },
  { field: "apiTradingHalt", whenTrue: "token.halted", whenFalse: "token.resumed" },
  { field: "feedStale", whenTrue: "feed.stale", whenFalse: "feed.fresh" },
  { field: "canonical", whenTrue: "token.canonical", whenFalse: "token.noncanonical" },
];

// A transition needs a previous answer to differ from: the first read of a flag
// is a fact, not a change, so a fresh database does not announce 194 "fresh"
// feeds. Only fields the patch carries are compared.
function transitions(asset: TrackedAsset, before: StateRow | undefined, patch: StatePatch): AuthorityEventInput[] {
  if (!before) {
    return [];
  }
  const now = new Date();
  const base = { chainId: asset.chainId, assetId: asset.id, address: asset.address.toLowerCase(), symbol: asset.symbol, occurredAt: now };
  const events: AuthorityEventInput[] = [];
  for (const flag of FLAG_TRANSITIONS) {
    const next = patch[flag.field];
    const previous = before[flag.field];
    if (typeof next !== "boolean" || typeof previous !== "boolean" || next === previous) {
      continue;
    }
    events.push({ ...base, kind: next ? flag.whenTrue : flag.whenFalse, detail: { [flag.field]: next } });
  }
  if (typeof patch.uiMultiplier === "string" && before.uiMultiplier !== null && Number(patch.uiMultiplier) !== Number(before.uiMultiplier)) {
    events.push({
      ...base,
      kind: "multiplier.applied",
      key: patch.uiMultiplier,
      detail: { from: Number(before.uiMultiplier), to: Number(patch.uiMultiplier) },
    });
  }
  return events;
}

// Each pipeline owns a few columns and never touches the others: the multiplier
// job does not know the feed price, and must not blank it.
export async function patchState(asset: TrackedAsset, patch: StatePatch): Promise<void> {
  const before = await db.select().from(registryAssetState).where(eq(registryAssetState.assetId, asset.id)).limit(1);
  await db
    .insert(registryAssetState)
    .values({ assetId: asset.id, chainId: asset.chainId, address: asset.address.toLowerCase(), ...patch, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: registryAssetState.assetId, set: { ...patch, updatedAt: sql`now()` } });
  await emitEvents(transitions(asset, before[0], patch));
}
