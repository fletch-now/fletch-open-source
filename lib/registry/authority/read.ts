// What pages and the API read from the authority tables. Every function here
// retains recorded facts and applies current identity policy to legacy kinds. No
// "server-only" so the same reads serve route handlers and the ops report.

import { and, desc, eq, getTableColumns, gt, gte, inArray, isNotNull, like, sql, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  registryAssets,
  dexPools,
  assetActivityDaily,
  assetConcentration,
  authorityEvents,
  chainHealth,
  feedRounds,
  holderBalances,
  lookalikeTokens,
  registryAssetState,
  registryControlEvents,
  registryControlState,
  registryCorporateActions,
  registryMultiplierEvents,
  registrySupplyEvents,
  registrySupplySnapshots,
} from "@/lib/db/schema";

import { poolStateCurrent } from "./pool-state-query";

export type AssetState = typeof registryAssetState.$inferSelect & { dexStateCurrent?: boolean };
export type ControlEvent = typeof registryControlEvents.$inferSelect;
export type ControlState = typeof registryControlState.$inferSelect;
export type MultiplierEvent = typeof registryMultiplierEvents.$inferSelect;
export type SupplyEvent = typeof registrySupplyEvents.$inferSelect;
export type SupplySnapshot = typeof registrySupplySnapshots.$inferSelect;
export type CorporateAction = typeof registryCorporateActions.$inferSelect;
export type ChainHealthRow = typeof chainHealth.$inferSelect;
export type AuthorityEvent = typeof authorityEvents.$inferSelect;
export type Lookalike = typeof lookalikeTokens.$inferSelect;
export type FeedRound = typeof feedRounds.$inferSelect;
export type HolderRow = typeof holderBalances.$inferSelect;
export type Concentration = typeof assetConcentration.$inferSelect;
export type ActivityDay = typeof assetActivityDaily.$inferSelect;

export async function topHolders(assetId: string, limit = 50): Promise<HolderRow[]> {
  return db
    .select()
    .from(holderBalances)
    .where(and(eq(holderBalances.assetId, assetId), gt(holderBalances.rawBalance, sql`0`)))
    .orderBy(desc(holderBalances.rawBalance))
    .limit(Math.min(500, Math.max(1, limit)));
}

export async function holderCount(assetId: string): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(holderBalances)
    .where(and(eq(holderBalances.assetId, assetId), gt(holderBalances.rawBalance, sql`0`)));
  return Number(rows[0]?.n ?? 0);
}

export async function latestConcentration(assetId: string): Promise<Concentration | null> {
  const rows = await db.select().from(assetConcentration).where(eq(assetConcentration.assetId, assetId)).orderBy(desc(assetConcentration.day)).limit(1);
  return rows[0] ?? null;
}

export interface ActiveAsset {
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  day: string;
  transfers: number;
  volumeRaw: string;
  dvpTransfers: number;
  offhoursTransfers: number;
}

// The busiest assets on the latest day the ledger has written.
export async function mostActive(chainId: number, limit = 6): Promise<ActiveAsset[]> {
  const latest = await db.select({ day: sql<string | null>`max(${assetActivityDaily.day})` }).from(assetActivityDaily);
  const day = latest[0]?.day;
  if (!day) {
    return [];
  }
  const rows = await db
    .select({
      assetId: assetActivityDaily.assetId,
      symbol: registryAssets.symbol,
      name: registryAssets.name,
      decimals: registryAssets.decimals,
      day: assetActivityDaily.day,
      transfers: assetActivityDaily.transfers,
      volumeRaw: assetActivityDaily.volumeRaw,
      dvpTransfers: assetActivityDaily.dvpTransfers,
      offhoursTransfers: assetActivityDaily.offhoursTransfers,
    })
    .from(assetActivityDaily)
    .innerJoin(registryAssets, eq(registryAssets.id, assetActivityDaily.assetId))
    .where(and(eq(assetActivityDaily.day, day), eq(registryAssets.chainId, chainId), eq(registryAssets.assetType, "stock_token")))
    .orderBy(desc(assetActivityDaily.transfers))
    .limit(limit);
  return rows.map((row) => ({ ...row, volumeRaw: row.volumeRaw.split(".")[0] }));
}

export interface HeldAsset {
  assetId: string;
  symbol: string;
  name: string;
  holders: number;
  feedPrice: string | null;
  floatPct: string | null;
  unknownPct: string | null;
}

// The share of an asset's supply the latest concentration reading found in
// ordinary wallets, and the share it could not place. The day is the newest day
// in the table, not the newest day for this asset: the daily job writes every
// asset in one pass, so an asset missing from that day was skipped and reads
// null rather than showing an older reading as current.
export const LATEST_FLOAT_PCT = sql<string | null>`(
  select c.float_pct from asset_concentration c
  where c.asset_id = ${registryAssets.id} and c.day = (select max(day) from asset_concentration)
)`;

export const LATEST_UNKNOWN_PCT = sql<string | null>`(
  select c.unknown_pct from asset_concentration c
  where c.asset_id = ${registryAssets.id} and c.day = (select max(day) from asset_concentration)
)`;

// The most widely held Stock Tokens, by Blockscout's holder count, with how
// much of each is float.
export async function mostHeld(chainId: number, limit = 6): Promise<HeldAsset[]> {
  const rows = await db
    .select({
      assetId: registryAssetState.assetId,
      symbol: registryAssets.symbol,
      name: registryAssets.name,
      holders: registryAssetState.blockscoutHolders,
      feedPrice: registryAssetState.feedPrice,
      floatPct: LATEST_FLOAT_PCT,
      unknownPct: LATEST_UNKNOWN_PCT,
    })
    .from(registryAssetState)
    .innerJoin(registryAssets, eq(registryAssets.id, registryAssetState.assetId))
    .where(and(eq(registryAssets.chainId, chainId), eq(registryAssets.assetType, "stock_token"), isNotNull(registryAssetState.blockscoutHolders)))
    .orderBy(desc(registryAssetState.blockscoutHolders))
    .limit(limit);
  return rows.map((row) => ({ ...row, holders: row.holders ?? 0 }));
}

export async function activityFor(assetId: string, days = 30): Promise<ActivityDay[]> {
  return db
    .select()
    .from(assetActivityDaily)
    .where(eq(assetActivityDaily.assetId, assetId))
    .orderBy(desc(assetActivityDaily.day))
    .limit(Math.min(400, Math.max(1, days)));
}

// Newest first. `since` narrows to rounds updated after an instant.
export async function feedRoundsFor(assetId: string, limit = 100, since?: Date): Promise<FeedRound[]> {
  const where = since ? and(eq(feedRounds.assetId, assetId), gt(feedRounds.updatedAt, since)) : eq(feedRounds.assetId, assetId);
  return db
    .select()
    .from(feedRounds)
    .where(where)
    .orderBy(desc(feedRounds.updatedAt), desc(feedRounds.roundId))
    .limit(Math.min(2000, Math.max(1, limit)));
}

// Older rows inferred issuer origin from a caller-controlled beacon slot.
// Reinterpret that classification without rewriting their observations or ages.
function currentLookalike(row: Lookalike): Lookalike {
  return row.kind === "unlisted_stock" ? { ...row, kind: "unverified" } : row;
}

export async function lookalikesFor(assetId: string, limit = 25): Promise<Lookalike[]> {
  const rows = await db
    .select()
    .from(lookalikeTokens)
    .where(eq(lookalikeTokens.matchesAssetId, assetId))
    .orderBy(desc(lookalikeTokens.holders), lookalikeTokens.address)
    .limit(limit);
  return rows.map(currentLookalike);
}

export interface LookalikeTotals {
  total: number;
  exactName: number;
  // Deprecated: beacon observations cannot establish unlisted issuer deployment.
  unlistedStock: number;
  tickers: number;
  holders: number;
}

export async function lookalikeTotals(chainId: number): Promise<LookalikeTotals> {
  const rows = await db
    .select({
      total: sql<number>`count(*)`,
      exactName: sql<number>`count(*) filter (where ${lookalikeTokens.exactName})`,

      tickers: sql<number>`count(distinct ${lookalikeTokens.matchesSymbol})`,
      holders: sql<number>`coalesce(sum(${lookalikeTokens.holders}), 0)`,
    })
    .from(lookalikeTokens)
    .where(eq(lookalikeTokens.chainId, chainId));
  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    exactName: Number(row?.exactName ?? 0),
    unlistedStock: 0,
    tickers: Number(row?.tickers ?? 0),
    holders: Number(row?.holders ?? 0),
  };
}

// `offset` pages past the 1000-row cap; the order is holders desc then address,
// which can shift between scans, so a consumer paging a full copy dedupes by address.
export async function lookalikes(chainId: number, symbol?: string, limit = 300, offset = 0): Promise<Lookalike[]> {
  const where = symbol ? and(eq(lookalikeTokens.chainId, chainId), eq(lookalikeTokens.matchesSymbol, symbol)) : eq(lookalikeTokens.chainId, chainId);
  const rows = await db
    .select()
    .from(lookalikeTokens)
    .where(where)
    .orderBy(desc(lookalikeTokens.holders), lookalikeTokens.address)
    .limit(Math.min(1000, limit))
    .offset(offset);
  return rows.map(currentLookalike);
}

export async function lookalikesPage(chainId: number, input: { symbol?: string; kind?: string; limit: number; offset: number }): Promise<{ rows: Lookalike[]; total: number }> {
  const where = and(eq(lookalikeTokens.chainId, chainId),
    input.symbol ? eq(lookalikeTokens.matchesSymbol, input.symbol) : undefined,
    input.kind ? eq(sql`case when ${lookalikeTokens.kind} = 'unlisted_stock' then 'unverified' else ${lookalikeTokens.kind} end`, input.kind === "unlisted_stock" ? "unverified" : input.kind) : undefined);
  const [rows, count] = await Promise.all([
    db.select().from(lookalikeTokens).where(where)
      .orderBy(sql`${lookalikeTokens.holders} desc nulls last`, lookalikeTokens.address, lookalikeTokens.id)
      .limit(Math.min(1000, Math.max(1, input.limit))).offset(Math.max(0, input.offset)),
    db.select({ total: sql<number>`count(*)` }).from(lookalikeTokens).where(where),
  ]);
  return { rows: rows.map(currentLookalike), total: Number(count[0]?.total ?? 0) };
}

export interface AuthorityEventFilter {
  kind?: string;
  symbol?: string;
  assetId?: string;
  // Only events observed after this instant (the JSON cursor and the SSE
  // Last-Event-ID both resolve to one).
  after?: Date;
  limit?: number;
}

function authorityEventConditions(chainId: number, filter: AuthorityEventFilter) {
  const conditions = [eq(authorityEvents.chainId, chainId)];
  if (filter.kind) {
    conditions.push(filter.kind.endsWith(".") ? like(authorityEvents.kind, `${filter.kind}%`) : eq(authorityEvents.kind, filter.kind));
  }
  if (filter.symbol) {
    conditions.push(eq(authorityEvents.symbol, filter.symbol));
  }
  if (filter.assetId) {
    conditions.push(eq(authorityEvents.assetId, filter.assetId));
  }
  if (filter.after) {
    conditions.push(gt(authorityEvents.observedAt, filter.after));
  }
  return and(...conditions);
}

// Newest first, for pages and feeds.
export async function recentAuthorityEvents(chainId: number, filter: AuthorityEventFilter = {}): Promise<AuthorityEvent[]> {
  return db
    .select()
    .from(authorityEvents)
    .where(authorityEventConditions(chainId, filter))
    .orderBy(desc(authorityEvents.observedAt), desc(authorityEvents.id))
    .limit(Math.min(500, Math.max(1, filter.limit ?? 100)));
}

// A cursor is an instant plus the id of the last event seen at that instant:
// a batch inserted in one statement shares one observed_at, so paging on the
// time alone would skip the rest of the batch.
export interface EventCursor {
  after: Date;
  afterId: string | null;
}

export function parseEventCursor(value: string | null): EventCursor | null {
  if (!value) {
    return null;
  }
  const [instant, id] = value.split("|");
  const after = new Date(instant);
  return Number.isNaN(after.getTime()) ? null : { after, afterId: id ?? null };
}

export function eventCursorOf(event: AuthorityEvent): string {
  return `${event.observedAt.toISOString()}|${event.id}`;
}

// The cursor carries milliseconds and the column microseconds. A page is
// ordered and ranged by the same key, (observed_at to the millisecond, id),
// so a row is neither sent twice nor skipped whichever microsecond it landed
// on; ordering by the raw column while ranging by the millisecond lost rows
// whose id sorted below the page's last id.
const observedAtMs = sql`date_trunc('milliseconds', ${authorityEvents.observedAt})`;

// Oldest first, for a consumer catching up from a cursor.
export async function authorityEventsAfter(chainId: number, cursor: EventCursor, limit = 200): Promise<AuthorityEvent[]> {
  // Bound as text with an explicit cast: the column is timestamp without time
  // zone, and a bare Date parameter would arrive with the process's offset.
  const after = sql`${cursor.after.toISOString()}::timestamp`;
  const afterCursor = cursor.afterId
    ? or(gt(observedAtMs, after), and(eq(observedAtMs, after), gt(authorityEvents.id, cursor.afterId)))
    : gt(authorityEvents.observedAt, cursor.after);
  // Implied by afterCursor; stated on the column so the (chain, observed_at)
  // index bounds the scan.
  const indexBound = gte(authorityEvents.observedAt, cursor.after);
  return db
    .select()
    .from(authorityEvents)
    .where(and(eq(authorityEvents.chainId, chainId), indexBound, afterCursor))
    .orderBy(observedAtMs, authorityEvents.id)
    .limit(limit);
}

export async function authorityEventById(id: string): Promise<AuthorityEvent | null> {
  const rows = await db.select().from(authorityEvents).where(eq(authorityEvents.id, id)).limit(1);
  return rows[0] ?? null;
}

// When the changelog started, and whether that is inside the window a page
// is about to describe, decided here so the page renders without a clock.
export async function changelogStart(chainId: number, windowDays: number): Promise<{ at: Date | null; withinWindow: boolean }> {
  const rows = await db.select({ at: sql<Date | null>`min(${authorityEvents.observedAt})` }).from(authorityEvents).where(eq(authorityEvents.chainId, chainId));
  const at = rows[0]?.at ? new Date(rows[0].at) : null;
  return { at, withinWindow: at !== null && Date.now() - at.getTime() < windowDays * 86_400_000 };
}

export async function authorityEventCounts(chainId: number, days: number): Promise<Array<{ kind: string; count: number }>> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ kind: authorityEvents.kind, count: sql<number>`count(*)` })
    .from(authorityEvents)
    .where(and(eq(authorityEvents.chainId, chainId), gte(authorityEvents.observedAt, since)))
    .groupBy(authorityEvents.kind)
    .orderBy(desc(sql`count(*)`));
  return rows.map((row) => ({ kind: row.kind, count: Number(row.count) }));
}

const assetPoolMembership = and(eq(dexPools.chainId, registryAssetState.chainId), eq(dexPools.id, registryAssetState.dexPoolId),
  eq(dexPools.assetId, registryAssetState.assetId), eq(dexPools.canonical, true));
const assetStateColumns = {
  ...getTableColumns(registryAssetState), dexStateCurrent: poolStateCurrent.mapWith(Boolean),
  poolPriceUsd: dexPools.priceUsd, poolDepthUsd: dexPools.depthUsd, poolLiquidity: dexPools.liquidity,
  poolCheckedAt: dexPools.stateCheckedAt, poolVenue: dexPools.venue,
};
interface JoinedAssetState extends AssetState {
  poolPriceUsd: string | null; poolDepthUsd: string | null; poolLiquidity: string | null;
  poolCheckedAt: Date | null; poolVenue: string | null;
}

function projectedAssetState(row: JoinedAssetState): AssetState {
  const { poolPriceUsd, poolDepthUsd, poolLiquidity, poolCheckedAt, poolVenue, ...state } = row;
  const samePremiumInputs = state.dexCheckedAt?.getTime() === poolCheckedAt?.getTime() && state.dexPriceUsd === poolPriceUsd;
  return { ...state, dexVenue: poolVenue ?? state.dexVenue, dexCheckedAt: poolCheckedAt ?? state.dexCheckedAt,
    dexPriceUsd: state.dexStateCurrent ? poolPriceUsd : null, dexDepthUsd: state.dexStateCurrent ? poolDepthUsd : null,
    dexLiquidity: state.dexStateCurrent ? poolLiquidity : null,
    dexPremiumPct: state.dexStateCurrent && samePremiumInputs ? state.dexPremiumPct : null };
}

export async function stateFor(assetId: string): Promise<AssetState | null> {
  const rows = await db.select(assetStateColumns).from(registryAssetState).leftJoin(dexPools, assetPoolMembership)
    .where(eq(registryAssetState.assetId, assetId)).limit(1);
  return rows[0] ? projectedAssetState(rows[0]) : null;
}

export async function statesFor(assetIds: string[]): Promise<Map<string, AssetState>> {
  if (assetIds.length === 0) return new Map();
  const rows = await db.select(assetStateColumns).from(registryAssetState).leftJoin(dexPools, assetPoolMembership)
    .where(inArray(registryAssetState.assetId, assetIds));
  return new Map(rows.map((row) => [row.assetId, projectedAssetState(row)]));
}

export async function controlState(chainId: number): Promise<ControlState | null> {
  const rows = await db.select().from(registryControlState).where(eq(registryControlState.chainId, chainId)).limit(1);
  return rows[0] ?? null;
}

// Newest first, so an offset walk that straddles a new event repeats one row
// on the next page; a consumer copying the log dedupes by (txHash, logIndex).
export async function recentControlEvents(chainId: number, limit = 50, offset = 0): Promise<ControlEvent[]> {
  return db
    .select()
    .from(registryControlEvents)
    .where(eq(registryControlEvents.chainId, chainId))
    .orderBy(desc(registryControlEvents.blockNumber), desc(registryControlEvents.logIndex))
    .limit(limit)
    .offset(offset);
}

export async function controlEventsForAccount(account: string, limit = 50): Promise<ControlEvent[]> {
  return db
    .select()
    .from(registryControlEvents)
    .where(eq(registryControlEvents.account, account.toLowerCase()))
    .orderBy(desc(registryControlEvents.blockNumber))
    .limit(limit);
}

export async function multiplierHistory(assetId: string, limit = 50): Promise<MultiplierEvent[]> {
  return db.select().from(registryMultiplierEvents).where(eq(registryMultiplierEvents.assetId, assetId)).orderBy(desc(registryMultiplierEvents.blockNumber)).limit(limit);
}

export async function recentMultiplierEvents(chainId: number, limit = 20): Promise<MultiplierEvent[]> {
  return db.select().from(registryMultiplierEvents).where(eq(registryMultiplierEvents.chainId, chainId)).orderBy(desc(registryMultiplierEvents.blockNumber)).limit(limit);
}

export async function supplyHistory(assetId: string, limit = 50): Promise<SupplyEvent[]> {
  return db.select().from(registrySupplyEvents).where(eq(registrySupplyEvents.assetId, assetId)).orderBy(desc(registrySupplyEvents.blockNumber)).limit(limit);
}

export async function supplySnapshots(assetId: string, limit = 30): Promise<SupplySnapshot[]> {
  return db.select().from(registrySupplySnapshots).where(eq(registrySupplySnapshots.assetId, assetId)).orderBy(desc(registrySupplySnapshots.day)).limit(limit);
}

export async function corporateActionsFor(symbol: string, limit = 20): Promise<CorporateAction[]> {
  return db
    .select()
    .from(registryCorporateActions)
    .where(eq(registryCorporateActions.symbol, symbol))
    .orderBy(sql`${registryCorporateActions.processDate} desc nulls last`)
    .limit(limit);
}

export async function upcomingCorporateActions(limit = 30): Promise<CorporateAction[]> {
  return db
    .select()
    .from(registryCorporateActions)
    .where(eq(registryCorporateActions.status, "in_progress"))
    .orderBy(sql`${registryCorporateActions.processDate} asc nulls last`)
    .limit(limit);
}

export async function latestHealth(chainId: number): Promise<ChainHealthRow | null> {
  const rows = await db.select().from(chainHealth).where(eq(chainHealth.chainId, chainId)).orderBy(desc(chainHealth.checkedAt)).limit(1);
  return rows[0] ?? null;
}

export interface AuthoritySummary {
  tokensWithState: number;
  canonical: number;
  paused: number;
  withPendingMultiplier: number;
  feedsRead: number;
  feedsStale: number;
  supplyMismatches: number;
  // The day of the latest reconciliation, or null while the backfill is still
  // behind head and no snapshot has been taken.
  supplySnapshotDay: string | null;
  blockedAddresses: number | null;
  registryPaused: boolean | null;
  lastStateAt: Date | null;
  // Tokens borrowing a listed ticker or exact name at another address.
  lookalikes: number;
  exactNameLookalikes: number;
  // Contract supply against Blockscout's count, per asset.
  supplyAgree: number;
  supplyDiffer: number;
  secondSourceAt: Date | null;
}

// The numbers the registry page's header strip shows.
export async function authoritySummary(chainId: number): Promise<AuthoritySummary> {
  const [state, control, mismatches, lookalikeRows] = await Promise.all([
    db
      .select({
        tokensWithState: sql<number>`count(*) filter (where ${registryAssetState.uiMultiplier} is not null)`,
        canonical: sql<number>`count(*) filter (where ${registryAssetState.canonical})`,
        paused: sql<number>`count(*) filter (where ${registryAssetState.tokenPaused})`,
        withPendingMultiplier: sql<number>`count(*) filter (where ${registryAssetState.multiplierEffectiveAt} > now())`,
        feedsRead: sql<number>`count(*) filter (where ${registryAssetState.feedPrice} is not null)`,
        feedsStale: sql<number>`count(*) filter (where ${registryAssetState.feedStale})`,
        lastStateAt: sql<Date | null>`max(${registryAssetState.stateCheckedAt})`,
        supplyAgree: sql<number>`count(*) filter (where ${registryAssetState.supplyAgreement} in ('agree', 'close'))`,
        supplyDiffer: sql<number>`count(*) filter (where ${registryAssetState.supplyAgreement} = 'differ')`,
        secondSourceAt: sql<Date | null>`max(${registryAssetState.blockscoutCheckedAt})`,
      })
      .from(registryAssetState)
      .where(eq(registryAssetState.chainId, chainId)),
    controlState(chainId),
    db
      .select({
        n: sql<number>`count(distinct ${registrySupplySnapshots.assetId}) filter (where ${registrySupplySnapshots.residualRaw} <> 0)`,
        day: sql<string | null>`max(${registrySupplySnapshots.day})`,
      })
      .from(registrySupplySnapshots)
      .where(eq(registrySupplySnapshots.day, sql`(select max(day) from registry_supply_snapshots)`)),
    db
      .select({
        total: sql<number>`count(*)`,
        exactName: sql<number>`count(*) filter (where ${lookalikeTokens.exactName})`,
      })
      .from(lookalikeTokens)
      .where(eq(lookalikeTokens.chainId, chainId)),
  ]);
  const row = state[0];
  return {
    tokensWithState: Number(row?.tokensWithState ?? 0),
    canonical: Number(row?.canonical ?? 0),
    paused: Number(row?.paused ?? 0),
    withPendingMultiplier: Number(row?.withPendingMultiplier ?? 0),
    feedsRead: Number(row?.feedsRead ?? 0),
    feedsStale: Number(row?.feedsStale ?? 0),
    supplyMismatches: Number(mismatches[0]?.n ?? 0),
    supplySnapshotDay: mismatches[0]?.day ?? null,
    blockedAddresses: control?.blockedCount ?? null,
    registryPaused: control?.paused ?? null,
    lastStateAt: row?.lastStateAt ? new Date(row.lastStateAt) : null,
    lookalikes: Number(lookalikeRows[0]?.total ?? 0),
    exactNameLookalikes: Number(lookalikeRows[0]?.exactName ?? 0),
    supplyAgree: Number(row?.supplyAgree ?? 0),
    supplyDiffer: Number(row?.supplyDiffer ?? 0),
    secondSourceAt: row?.secondSourceAt ? new Date(row.secondSourceAt) : null,
  };
}
