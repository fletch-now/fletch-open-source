// One row per asset per UTC day holding every number the registry publishes
// about it that day: the multiplier, the flags, the feed and quote prices, the
// DEX price and premium, supply, and the three counts beside them. The live
// tables carry only the current answer, so without this a question about a past
// day — what the premium was on a Tuesday in August — has no source at all.
//
// The run repeats hourly and upserts on `<assetId>:<day>`, so the day's row is
// the last reading taken that day and no day can be skipped by a timer that
// drifts over midnight. A figure is copied only when the job that writes it
// read it that day: a stalled writer, or a pool that stopped being priced,
// leaves its last answer standing in registry_asset_state, and copying that
// forward would record a week-old number as seven days of readings.
//
// No new event kinds: every field copied here is already watched at its own
// cadence by the job that writes it (token-state, feeds, api-prices, dex-state),
// and a change first noticed a day late would be news that is already old.

import { and, count, eq, gt, gte, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetStateDaily, holderBalances, lookalikeTokens, registryAssetState } from "@/lib/db/schema";
import { activeAssets } from "@/lib/registry/authority/assets";
import { stillFilling } from "@/lib/registry/authority/cadence";
import { uncoveredAssets } from "@/lib/registry/authority/coverage";
import { LEDGER_NAME, ledgerProgress } from "@/lib/registry/authority/ledger";
import { lastRunOf, type RunOutcome } from "@/lib/registry/authority/runs";

export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function ledgerHoldersByAsset(): Promise<Map<string, number>> {
  const rows = await db
    .select({ assetId: holderBalances.assetId, holders: count() })
    .from(holderBalances)
    .where(gt(holderBalances.rawBalance, sql`0`))
    .groupBy(holderBalances.assetId);
  return new Map(rows.map((row) => [row.assetId, row.holders]));
}

async function lookalikesByAsset(chainId: number): Promise<Map<string, number>> {
  const rows = await db
    .select({ assetId: lookalikeTokens.matchesAssetId, tokens: count() })
    .from(lookalikeTokens)
    .where(eq(lookalikeTokens.chainId, chainId))
    .groupBy(lookalikeTokens.matchesAssetId);
  return new Map(rows.map((row) => [row.assetId, row.tokens]));
}

// A figure belongs to the day its writer read it on. Anything older is the
// previous answer still standing, which is not a reading for this day.
function readOn(checkedAt: Date | null, day: string): boolean {
  return checkedAt !== null && utcDay(checkedAt) === day;
}

export async function snapshotStateDaily(chainId: number): Promise<RunOutcome> {
  const day = utcDay(new Date());
  const [states, assets, holders, lookalikes, lookalikeRun, progress] = await Promise.all([
    db.select().from(registryAssetState).where(eq(registryAssetState.chainId, chainId)),
    activeAssets(chainId),
    ledgerHoldersByAsset(),
    lookalikesByAsset(chainId),
    lastRunOf("lookalikes"),
    ledgerProgress(chainId),
  ]);
  // A holder count taken while the ledger is mid-history is not the day's
  // holder count; it is how far the scanner got. That holds per asset as well
  // as globally: an asset listed after the checkpoint reached head still needs
  // its own pass, and until it has one it has no balances to count.
  const ledgerAtHead = progress.behind !== null && !stillFilling(progress.behind);
  const uncovered = new Set((await uncoveredAssets(LEDGER_NAME, assets)).map((asset) => asset.id));
  // A first scan writes nothing for an asset with no lookalikes, which reads
  // the same as an asset the scan has not reached. Only a completed scan can
  // tell those apart, so before one there is no count to record.
  const lookalikesScanned = lookalikeRun?.ok === true;
  let written = 0;
  for (const state of states) {
    const stateRead = readOn(state.stateCheckedAt, day);
    const feedRead = readOn(state.feedCheckedAt, day);
    const apiRead = readOn(state.apiCheckedAt, day);
    const dexRead = readOn(state.dexCheckedAt, day);
    const secondSourceRead = readOn(state.blockscoutCheckedAt, day);
    const ledgerCounted = ledgerAtHead && !uncovered.has(state.assetId);
    const row = {
      id: `${state.assetId}:${day}`,
      assetId: state.assetId,
      day,
      uiMultiplier: stateRead ? state.uiMultiplier : null,
      tokenPaused: stateRead ? state.tokenPaused : null,
      oraclePaused: stateRead ? state.oraclePaused : null,
      apiTradingHalt: apiRead ? state.apiTradingHalt : null,
      feedPrice: feedRead ? state.feedPrice : null,
      feedStale: feedRead ? state.feedStale : null,
      apiBid: apiRead ? state.apiBid : null,
      apiAsk: apiRead ? state.apiAsk : null,
      priceDivergencePct: apiRead ? state.priceDivergencePct : null,
      dexPriceUsd: dexRead ? state.dexPriceUsd : null,
      dexPremiumPct: dexRead ? state.dexPremiumPct : null,
      dexLiquidity: dexRead ? state.dexLiquidity : null,
      totalSupplyRaw: stateRead ? state.totalSupplyRaw : null,
      blockscoutHolders: secondSourceRead ? state.blockscoutHolders : null,
      ledgerHolders: ledgerCounted ? (holders.get(state.assetId) ?? 0) : null,
      lookalikes: lookalikesScanned ? (lookalikes.get(state.assetId) ?? 0) : null,
      stateCheckedAt: state.stateCheckedAt,
      feedCheckedAt: state.feedCheckedAt,
      apiCheckedAt: state.apiCheckedAt,
      dexCheckedAt: state.dexCheckedAt,
      blockscoutCheckedAt: state.blockscoutCheckedAt,
    };
    await db
      .insert(assetStateDaily)
      .values(row)
      .onConflictDoUpdate({ target: assetStateDaily.id, set: { ...row, takenAt: new Date() } });
    written += 1;
  }
  return {
    rows: written,
    detail: { day, ledgerAtHead, ledgerUncovered: uncovered.size, lookalikesScanned, behind: progress.behind?.toString() ?? null },
  };
}

export interface HistoryWindow {
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;

// A window of `days` UTC days ending on `to` inclusive, so 1 day is `to` alone.
export function windowEndingOn(to: string, days: number): HistoryWindow {
  return { from: utcDay(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS)), to };
}

// Every UTC day in the window, including the ones with no row. A chart drawn
// from the rows alone puts point i at index i, which draws a straight line
// across a day nobody snapshotted instead of a gap.
export function daysBetween(window: HistoryWindow): string[] {
  const last = Date.parse(`${window.to}T00:00:00Z`);
  const days: string[] = [];
  for (let at = Date.parse(`${window.from}T00:00:00Z`); at <= last; at += DAY_MS) {
    days.push(utcDay(new Date(at)));
  }
  return days;
}

export type StateDay = typeof assetStateDaily.$inferSelect;

// Oldest first: a chart reads left to right and a table reverses once.
export async function historyFor(assetId: string, window: HistoryWindow): Promise<StateDay[]> {
  return db
    .select()
    .from(assetStateDaily)
    .where(and(eq(assetStateDaily.assetId, assetId), gte(assetStateDaily.day, window.from), lte(assetStateDaily.day, window.to)))
    .orderBy(assetStateDaily.day);
}

export async function stateOn(assetId: string, day: string): Promise<StateDay | null> {
  const rows = await db.select().from(assetStateDaily).where(eq(assetStateDaily.id, `${assetId}:${day}`)).limit(1);
  return rows[0] ?? null;
}

export interface HistoryCoverage {
  days: number;
  firstDay: string | null;
  latestDay: string | null;
}

// What the page and the API say about their own reach: a 90-day window over
// two days of rows is two days, and the reader is told so.
export async function historyCoverage(assetId: string): Promise<HistoryCoverage> {
  const rows = await db
    .select({ days: count(), firstDay: sql<string | null>`min(${assetStateDaily.day})`, latestDay: sql<string | null>`max(${assetStateDaily.day})` })
    .from(assetStateDaily)
    .where(eq(assetStateDaily.assetId, assetId));
  const row = rows[0];
  return { days: row?.days ?? 0, firstDay: row?.firstDay ?? null, latestDay: row?.latestDay ?? null };
}
