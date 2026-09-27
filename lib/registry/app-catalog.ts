import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { robinhoodAppPairs, robinhoodAppSync } from "@/lib/db/schema";
import { emitEvents, type AuthorityEventInput } from "./authority/events";
import type { RunOutcome } from "./authority/runs";
import { APP_CATALOG_SOURCE, APP_CATALOG_SCOPE, APP_CATALOG_STALE_MS, appStatus, appStatusLabel, catalogPageSchema, changedCatalogFields, orderSizeClamped, type AppCatalogStatus, type CatalogPair } from "./app-catalog-model";

export async function fetchAppCatalog(fetcher: typeof fetch = fetch): Promise<CatalogPair[]> {
  let url: string | null = APP_CATALOG_SOURCE;
  const visited = new Set<string>();
  const pairs: CatalogPair[] = [];
  while (url) {
    if (visited.has(url) || visited.size >= 20) throw new Error("Robinhood catalog pagination changed or exceeded 20 pages; previous snapshot retained");
    const next = new URL(url);
    if (next.origin !== new URL(APP_CATALOG_SOURCE).origin || next.pathname !== "/currency_pairs/") throw new Error("Robinhood catalog pagination points outside its source; previous snapshot retained");
    visited.add(url);
    // The live public endpoint varies its catalog by User-Agent. This tested
    // profile includes display-only pairs; generic Node/Fletch profiles omit them.
    const response = await fetcher(url, { headers: { accept: "application/json", "user-agent": "curl/8.7.1" }, signal: AbortSignal.timeout(10_000), redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(`Robinhood catalog HTTP ${response.status}; previous snapshot retained`);
    const parsed = catalogPageSchema.safeParse(await response.json());
    if (!parsed.success) throw new Error(`Robinhood catalog schema changed: ${parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
    pairs.push(...parsed.data.results);
    url = parsed.data.next;
  }
  if (new Set(pairs.map((pair) => pair.id)).size !== pairs.length) throw new Error("Robinhood catalog repeats pair IDs; previous snapshot retained");
  if (pairs.some((pair) => appStatus([pair]) === "unavailable" || !Object.keys(pair.tradability_by_account_type).length)) throw new Error("Robinhood catalog has conflicting display or account tradability fields; previous snapshot retained");
  return pairs;
}

export async function syncAppCatalog(chainId: number, fetcher: typeof fetch = fetch): Promise<RunOutcome> {
  // The source is global. A transaction lock also prevents an older, slower
  // request from committing after a newer observation from another process.
  try {
    return await db.transaction(async function sync(tx): Promise<RunOutcome> {
      await tx.execute(sql`select pg_advisory_xact_lock(73462059)`);
      const pairs = await fetchAppCatalog(fetcher);
      const at = new Date();
      const [sync] = await tx.select().from(robinhoodAppSync).where(eq(robinhoodAppSync.id, "catalog"));
      const previous = await tx.select().from(robinhoodAppPairs);
      if (sync?.pairCount && pairs.length < sync.pairCount * 0.8) throw new Error("Robinhood catalog lost more than 20% of pairs in one response; review required, previous snapshot retained");
      const baseline = !sync?.observedAt;
      const known = new Map(previous.map((row) => [row.id, row]));
      const present = new Set(pairs.map((pair) => pair.id));
      const events: AuthorityEventInput[] = [];
      for (const pair of pairs) {
        const before = known.get(pair.id);
        const changed = before?.present ? changedCatalogFields(before.pair, pair) : [];
        if (!before?.present || changed.length) {
          let kind: AuthorityEventInput["kind"] = "listing.changed";
          if (!before?.present) kind = baseline ? "listing.observed" : "listing.added";
          let action = "catalog fields changed";
          if (kind === "listing.observed") action = "first observed by Fletch";
          if (kind === "listing.added") action = "added to the observed catalog";
          events.push({ chainId, kind, symbol: pair.asset_currency.code, occurredAt: at, key: `${pair.id}:${at.toISOString()}`,
            detail: { source: APP_CATALOG_SOURCE, baseline, pairId: pair.id, before: before?.present ? before.pair : null, after: pair, changedFields: changed,
              orderSizeLeftClamp: Boolean(before?.present && orderSizeClamped(before.pair.max_order_size) && !orderSizeClamped(pair.max_order_size)),
              summary: `${pair.asset_currency.code}: ${appStatusLabel(appStatus([pair]))}; ${action}.` } });
        }
        if (!before?.present || changed.length) await tx.insert(robinhoodAppPairs).values({ id: pair.id, symbol: pair.asset_currency.code.toUpperCase(), name: pair.asset_currency.name, pair, present: true, firstObservedAt: at, observedAt: at })
          .onConflictDoUpdate({ target: robinhoodAppPairs.id, set: { symbol: pair.asset_currency.code.toUpperCase(), name: pair.asset_currency.name, pair, present: true, observedAt: at } });
      }
      for (const old of previous.filter((row) => row.present && !present.has(row.id))) {
        await tx.update(robinhoodAppPairs).set({ present: false, observedAt: at }).where(eq(robinhoodAppPairs.id, old.id));
        events.push({ chainId, kind: "listing.removed", symbol: old.symbol, occurredAt: at, key: `${old.id}:${at.toISOString()}`,
          detail: { source: APP_CATALOG_SOURCE, pairId: old.id, before: old.pair, after: null, summary: `${old.symbol}: pair ${old.pair.symbol} removed from the observed Robinhood crypto catalog.` } });
      }
      const inserted = await emitEvents(events, tx);
      await tx.insert(robinhoodAppSync).values({ id: "catalog", attemptedAt: at, observedAt: at, error: null, pairCount: pairs.length })
        .onConflictDoUpdate({ target: robinhoodAppSync.id, set: { attemptedAt: at, observedAt: at, error: null, pairCount: pairs.length } });
      return { rows: pairs.length, detail: { events: inserted, baseline, source: APP_CATALOG_SOURCE, observedAt: at.toISOString() } };
    });
  } catch (cause) {
    const error = (cause instanceof Error ? cause.message : String(cause)).slice(0, 500);
    await db.insert(robinhoodAppSync).values({ id: "catalog", attemptedAt: new Date(), error })
      .onConflictDoUpdate({ target: robinhoodAppSync.id, set: { attemptedAt: new Date(), error } });
    throw cause;
  }
}

export interface CatalogReading {
  observedAt: string | null;
  ageSeconds: number | null;
  stale: boolean;
  error: string | null;
  source: string;
  pairs: CatalogPair[];
}

export async function readAppCatalog(): Promise<CatalogReading> {
  const [syncs, rows] = await Promise.all([db.select().from(robinhoodAppSync).where(eq(robinhoodAppSync.id, "catalog")), db.select().from(robinhoodAppPairs).where(eq(robinhoodAppPairs.present, true))]);
  const sync = syncs[0];
  const age = sync?.observedAt ? Date.now() - sync.observedAt.getTime() : null;
  return { observedAt: sync?.observedAt?.toISOString() ?? null, ageSeconds: age === null ? null : Math.floor(age / 1000),
    stale: age === null || age < 0 || age > APP_CATALOG_STALE_MS, error: sync?.error ?? null, source: APP_CATALOG_SOURCE, pairs: rows.map((row) => row.pair) };
}

export function statusForSymbol(reading: CatalogReading, symbol: string | null, assetType?: string | null): AppCatalogStatus {
  if (assetType === "stock_token") return { ...reading, scope: APP_CATALOG_SCOPE, status: "not_covered", pairs: [], match: "none",
    reason: "This source covers crypto currency pairs. Stock Token membership is recorded separately by contract address in Robinhood’s Stock Token list." };
  const pairs = reading.pairs.filter((pair) => pair.asset_currency.code.toUpperCase() === symbol?.toUpperCase());
  let status: AppCatalogStatus["status"] = "unavailable";
  if (reading.observedAt && symbol) status = appStatus(pairs);
  let reason = "A matching crypto ticker does not verify this on-chain contract or establish availability for a specific account or region.";
  if (!reading.observedAt) reason = "No successful observation of the crypto currency-pairs source is available yet.";
  else if (!symbol) reason = "Token symbol has not been resolved, so this source cannot be matched.";
  else if (!pairs.length) reason = "No matching ticker was observed in the crypto currency-pairs source. This does not establish absence from other Robinhood products.";
  return { ...reading, scope: APP_CATALOG_SCOPE, reason, status, pairs, match: pairs.length ? "ticker_only" : "none" };
}
