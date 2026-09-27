// Robinhood's own quote per token, and the one comparison that catches the
// classic mistake: the API's bid and ask are the underlying share, the
// Chainlink feed is share × multiplier. Divergence is measured against the
// multiplier the chain reports, never assumed.

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryAssetState } from "@/lib/db/schema";
import { ROBINHOOD_PRICES_ENDPOINT } from "@/lib/registry/authority/constants";
import { activeAssets, patchState, type TrackedAsset } from "@/lib/registry/authority/assets";
import type { RunOutcome } from "@/lib/registry/authority/runs";

interface Quote {
  bid?: string;
  ask?: string;
  isTradingHalt?: boolean;
  dailyTradingVolume?: string;
}

// The documented ceiling is 60 requests a second; in practice five in flight
// drew 429s on a quarter of the symbols. Two in flight and one retry after a
// pause keeps a run of 194 tokens clean in under two minutes.
const CONCURRENCY = 2;
const RETRY_AFTER_MS = 1_500;

function sleep(ms: number): Promise<void> {
  return new Promise(function wait(resolve) {
    setTimeout(resolve, ms);
  });
}

async function fetchQuote(symbol: string, attempt = 1): Promise<Quote | null> {
  const response = await fetch(`${ROBINHOOD_PRICES_ENDPOINT}/${encodeURIComponent(symbol)}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (response.status === 429 && attempt === 1) {
    await sleep(RETRY_AFTER_MS);
    return fetchQuote(symbol, 2);
  }
  if (!response.ok) {
    throw new Error(`prices ${symbol}: ${response.status}`);
  }
  const body = (await response.json()) as { quotes?: Quote[] };
  return body.quotes?.[0] ?? null;
}

function divergence(feedPrice: string | null, bid: string, ask: string, multiplier: string | null): string | null {
  if (!feedPrice || !multiplier) {
    return null;
  }
  const mid = (Number(bid) + Number(ask)) / 2;
  const expected = mid * Number(multiplier);
  if (!Number.isFinite(expected) || expected === 0) {
    return null;
  }
  return (((Number(feedPrice) - expected) / expected) * 100).toFixed(4);
}

async function refreshOne(asset: TrackedAsset): Promise<boolean> {
  try {
    const quote = await fetchQuote(asset.symbol);
    if (!quote || quote.bid === undefined || quote.ask === undefined) {
      // The time stamp stays with the last good read: a failed fetch is not a reading.
      await patchState(asset, { apiError: "no quote" });
      return false;
    }
    const current = await db
      .select({ feedPrice: registryAssetState.feedPrice, multiplier: registryAssetState.uiMultiplier })
      .from(registryAssetState)
      .where(eq(registryAssetState.assetId, asset.id))
      .limit(1);
    await patchState(asset, {
      apiBid: quote.bid,
      apiAsk: quote.ask,
      apiTradingHalt: quote.isTradingHalt ?? null,
      apiDailyVolume: quote.dailyTradingVolume ?? null,
      apiCheckedAt: new Date(),
      apiError: null,
      priceDivergencePct: divergence(current[0]?.feedPrice ?? null, quote.bid, quote.ask, current[0]?.multiplier ?? null),
    });
    return true;
  } catch (cause) {
    await patchState(asset, { apiError: (cause instanceof Error ? cause.message : String(cause)).slice(0, 200) });
    return false;
  }
}

export async function refreshApiPrices(chainId: number): Promise<RunOutcome> {
  const assets = await activeAssets(chainId, "stock_token");
  const queue = [...assets];
  let updated = 0;
  async function worker(): Promise<void> {
    let asset = queue.shift();
    while (asset) {
      if (await refreshOne(asset)) {
        updated += 1;
      }
      asset = queue.shift();
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, assets.length) }, worker));
  return { rows: updated, detail: { assets: assets.length } };
}
