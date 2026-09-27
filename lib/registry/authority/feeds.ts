// Chainlink's equity feeds for Robinhood tokens: the answer, when it was last
// updated, and whether it is past its heartbeat. The feed directory is fetched
// once an hour; the answers every minute through Multicall3.

import type { Address, PublicClient } from "viem";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { registryAssetState } from "@/lib/db/schema";
import type { MetricCoverage } from "./metric-coverage";
import type { RoundReading } from "./feed-rounds";
import { AGGREGATOR_ABI } from "@/lib/registry/authority/abis";
import { l2Client, multicall } from "@/lib/registry/authority/chain";
import { CHAINLINK_FEED_DIRECTORY, FEED_HEARTBEAT_SECONDS } from "@/lib/registry/authority/constants";
import { activeAssets, patchState } from "@/lib/registry/authority/assets";
import { recordRounds } from "@/lib/registry/authority/feed-rounds";
import type { RunOutcome } from "@/lib/registry/authority/runs";

interface DirectoryEntry {
  name?: string;
  proxyAddress?: string;
  decimals?: number;
  heartbeat?: number;
}

export interface Feed {
  symbol: string;
  address: Address;
  decimals: number;
  heartbeatSeconds: number | null;
}

const DIRECTORY_TTL_MS = 60 * 60 * 1000;
let cached: { at: number; feeds: Feed[] } | null = null;

// "Robinhood TSLA / USD", "Robinhood SGOV-USD", "Robinhood DELL-USD": the
// ticker is the token between "Robinhood " and the first separator. Crypto
// feeds are plain "WBTC / USD"; ETH's feed prices WETH here, since the chain
// holds no unwrapped ETH token to attach it to.
function symbolOf(name: string): string | null {
  const equity = /^Robinhood ([A-Z0-9.]+)/.exec(name);
  if (equity) {
    return equity[1];
  }
  const crypto = /^([A-Za-z0-9.]+) \/ USD$/.exec(name);
  if (!crypto) {
    return null;
  }
  return crypto[1].toUpperCase() === "ETH" ? "WETH" : crypto[1].toUpperCase();
}

async function feedDirectory(): Promise<Feed[]> {
  if (cached && Date.now() - cached.at < DIRECTORY_TTL_MS) {
    return cached.feeds;
  }
  const response = await fetch(CHAINLINK_FEED_DIRECTORY, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`feed directory ${response.status}`);
  }
  const entries = (await response.json()) as DirectoryEntry[];
  const feeds: Feed[] = [];
  for (const entry of entries) {
    const symbol = entry.name ? symbolOf(entry.name) : null;
    if (symbol && entry.proxyAddress) {
      feeds.push({ symbol, address: entry.proxyAddress as Address, decimals: entry.decimals ?? 8,
        heartbeatSeconds: Number.isSafeInteger(entry.heartbeat) && Number(entry.heartbeat) > 0 ? Number(entry.heartbeat) : null });
    }
  }
  cached = { at: Date.now(), feeds };
  return feeds;
}

export { feedDirectory };

export function scaled(answer: bigint, decimals: number): string {
  const whole = answer / BigInt(10) ** BigInt(decimals);
  const fraction = (answer % BigInt(10) ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

export function validLatestRound(value: unknown, nowSeconds: number): RoundReading | null {
  if (!Array.isArray(value) || value.length !== 5 || !value.every((part) => typeof part === "bigint")) return null;
  const [roundId, answer, startedAt, updatedAt, answeredInRound] = value as bigint[];
  if (roundId <= BigInt(0) || answer <= BigInt(0) || startedAt < BigInt(0) || startedAt > updatedAt
    || updatedAt <= BigInt(0) || updatedAt > BigInt(nowSeconds) || answeredInRound < roundId) return null;
  return { roundId, answer, startedAt, updatedAt };
}

interface FeedRefreshOptions {
  client?: PublicClient;
  feeds?: Feed[];
  now?: () => Date;
}

export async function refreshFeeds(chainId: number, options: FeedRefreshOptions = {}): Promise<RunOutcome> {
  const clock = options.now ?? (() => new Date());
  const [feeds, assets] = await Promise.all([options.feeds ?? feedDirectory(), activeAssets(chainId)]);
  // Bridged symbols keep their issuer's casing (wstETH, cbBTC); feed names are upper case.
  const bySymbol = new Map(assets.map((asset) => [asset.symbol.toUpperCase(), asset]));
  const targets = feeds.filter((feed) => bySymbol.has(feed.symbol));
  const results = targets.length ? await multicall(options.client ?? l2Client(chainId), targets.map(function call(feed) {
    return { address: feed.address, abi: AGGREGATOR_ABI, functionName: "latestRoundData" };
  })) : [];
  let updated = 0;
  const failed: string[] = [];
  for (const [index, feed] of targets.entries()) {
    const asset = bySymbol.get(feed.symbol)!;
    const result = results[index];
    const checkedAt = clock();
    const reading = result?.status === "success" ? validLatestRound(result.result, Math.floor(checkedAt.getTime() / 1000)) : null;
    if (!reading || !Number.isSafeInteger(feed.decimals) || feed.decimals < 0 || feed.decimals > 255) {
      // Retain the source address too: a failed replacement feed cannot inherit another feed's price.
      failed.push(feed.address.toLowerCase());
      continue;
    }
    const heartbeat = feed.heartbeatSeconds ?? FEED_HEARTBEAT_SECONDS;
    await recordRounds(chainId, feed.address, asset, feed.decimals, [reading]);
    await patchState(asset, {
      feedAddress: feed.address.toLowerCase(),
      feedPrice: scaled(reading.answer, feed.decimals),
      feedUpdatedAt: new Date(Number(reading.updatedAt) * 1000),
      feedStale: checkedAt.getTime() / 1000 - Number(reading.updatedAt) > heartbeat,
      feedCheckedAt: checkedAt,
    });
    updated++;
  }
  const measuredAt = clock();
  const assetIds = targets.map((feed) => bySymbol.get(feed.symbol)!.id);
  const states = assetIds.length ? await db.select().from(registryAssetState)
    .where(and(eq(registryAssetState.chainId, chainId), inArray(registryAssetState.assetId, assetIds))) : [];
  const byId = new Map(states.map((state) => [state.assetId, state]));
  const coverage: MetricCoverage = { eligible: targets.length, current: 0, failed: failed.length, unread: 0, oldestInputAgeSeconds: null, measuredAt: measuredAt.toISOString() };
  for (const feed of targets) {
    const state = byId.get(bySymbol.get(feed.symbol)!.id);
    const sourceAt = state?.feedUpdatedAt?.getTime();
    const fetchedAt = state?.feedCheckedAt?.getTime();
    if (sourceAt === undefined || fetchedAt === undefined || state?.feedPrice === null || !state) {
      coverage.unread++;
      continue;
    }
    const sourceAge = (measuredAt.getTime() - sourceAt) / 1000;
    coverage.oldestInputAgeSeconds = Math.max(coverage.oldestInputAgeSeconds ?? 0, sourceAge);
    if (Number(state.feedPrice) > 0 && state.feedAddress === feed.address.toLowerCase() && state.feedStale === false
      && sourceAge >= 0 && sourceAge <= (feed.heartbeatSeconds ?? FEED_HEARTBEAT_SECONDS)
      && fetchedAt <= measuredAt.getTime() && measuredAt.getTime() - fetchedAt <= 180_000) coverage.current++;
  }
  return { rows: updated, error: failed.length ? `${failed.length} feed reads failed or returned invalid rounds` : undefined,
    detail: { feeds: targets.length, failed: failed.length, failedFeeds: failed, scope: "directory_feeds_matching_active_assets", metricCoverage: { oraclePrice: coverage } } };
}
