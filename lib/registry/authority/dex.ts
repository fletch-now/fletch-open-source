// The DEXs on Robinhood Chain: which pools trade a listed asset, what they
// price it at, how deep they are, and how far that sits from the Chainlink
// feed. Two venues, one table. Uniswap v4 keeps every pool inside one
// PoolManager, so discovery walks its Initialize events and state comes from
// StateView; Uniswap v3 makes a contract per pool, so discovery walks the
// factory's PoolCreated events and each pool answers for itself. The exact
// swap ledger and its independent coverage checkpoint live in discovery/swaps.
//
// The venue-independent parts — which side of a pair is the listed asset, the
// price from sqrtPriceX96 and the premium event — are
// shared, which is why both venues live in this module rather than one each.

import { and, count, eq, getTableColumns, gt, gte, inArray, isNotNull, isNull, lt, max, or, sql, type SQL } from "drizzle-orm";
import { erc20Abi, zeroAddress, type Address, type PublicClient } from "viem";
import { dueTokenReads, tokenMetadataBacklog } from "./dex-token-queue";
import { metadataFailureSummary } from "./dex-token-errors";
import { deferPoolStateReads, stateRetryIsDue } from "./dex-state-retry";
import { duePoolStateReads } from "./dex-state-schedule";
import { stateReadIsCurrent } from "./dex-state-freshness";
import { checkRpcBudget } from "@/lib/ratelimit";
import { checkMarketRpcBudget } from "./market-rpc-budget";
import { getMetadataClient, getMarketReadClient } from "@/lib/chain/rpc";
import { TOKEN_READ_BATCH, TOKEN_GROUP, TOKEN_WORK_MS, IMMEDIATE_TOKEN_PROBE_LIMIT } from "./dex-token-schedule";
import { db } from "@/lib/db";
import { readSwapIndexer } from "./market-swap-status";
import { poolQuoteObservation, poolStateCurrent } from "./pool-state-query";
import type { PoolQuoteObservation } from "../token-markets-types";
import { poolSwapColumns, poolSwapMembership } from "./market-swap-query";
import { dexPools, dexPriceSamples, dexTokens, marketPoolSwapMetrics, marketSwapIndexState, registryAssetState } from "@/lib/db/schema";
import { sidesOf, type PricedSide } from "@/lib/registry/authority/dex-sides";
import { ACTIVE_DEPTH_USD, POOL_TIERS, tierOf, type PoolTier } from "@/lib/registry/authority/dex-tiers";
import { logEvent } from "@/lib/log";
import { POOL_MANAGER_ABI, STATE_VIEW_ABI, UNISWAP_V3_FACTORY_ABI, UNISWAP_V3_POOL_ABI } from "@/lib/registry/authority/abis";
import { activeAssets, patchState, type TrackedAsset } from "@/lib/registry/authority/assets";
import { blockHash, decodeLogs, l2Client, multicall, scanLogs, type MulticallCall, type MulticallResult } from "@/lib/registry/authority/chain";
import { backfillStart, POOL_LOG_CHUNK, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, UNISWAP_V4_STATE_VIEW, V3_POOL_LOG_CHUNK, V3_POOL_STEP_BLOCKS, VENUE_V3, VENUE_V4 } from "@/lib/registry/authority/constants";
import { stillFilling } from "@/lib/registry/authority/cadence";
import { onePctDepthUsd, usdOf, withinVenueHoldings } from "@/lib/registry/authority/depth";
import { emitEvents } from "@/lib/registry/authority/events";
import { lastFinishedRunOf, lastRunOf, readCheckpoint, recordedHead, writeCheckpoint, type RunOutcome } from "@/lib/registry/authority/runs";
import { recordFoldedLookalike } from "@/lib/registry/authority/lookalikes";
import { foldTicker } from "@/lib/registry/trust-rules";
import { verifiedAssetIndex, type VerifiedAsset } from "@/lib/registry/trust";

const POOLS_NAME = "dex-pools";
const POOLS_V3_NAME = "dex-pools-v3";
const CONFIRMATIONS = BigInt(30);
// A premium is announced only where there is enough depth to trade against.
// The floor is dollars, not Uniswap's L: L is in units of
// sqrt(token0_raw * token1_raw), so the same L means about a million times
// more money in a USDG pool (6 decimals) than in a WETH pool (18), and a raw
// floor fired on pools holding a few dollars.
const PREMIUM_EVENT_PCT = 2;
const PREMIUM_DEPTH_FLOOR_USD = 10_000;
const Q96 = 2 ** 96;

export type DexPool = typeof dexPools.$inferSelect & {
  quoteObservation?: PoolQuoteObservation | null;
  stateObservationCurrent?: boolean;
  metricsWindowStartAt?: Date | null;
  metricsCoverageComplete?: boolean;
  metricsCurrent?: boolean;
  volume0Raw?: string | null;
  volume1Raw?: string | null;
  volumeValuation?: Record<string, unknown> | null;
};
export type DexToken = typeof dexTokens.$inferSelect;
type PoolRow = DexPool;

// New pools only: the id is the primary key, so re-scanning a window inserts
// nothing and the count stays the count of pools that were not on record.
const POOL_INSERT_BATCH = 500;

async function insertPools(rows: (typeof dexPools.$inferInsert)[]): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < rows.length; start += POOL_INSERT_BATCH) {
    const done = await db
      .insert(dexPools)
      .values(rows.slice(start, start + POOL_INSERT_BATCH))
      .onConflictDoNothing()
      .returning({ id: dexPools.id });
    inserted += done.length;
  }
  return inserted;
}

async function discoverSide(chainId: number, indexedArg: "currency0" | "currency1", addresses: Address[], from: bigint, head: bigint, byAddress: Map<string, TrackedAsset>): Promise<number> {
  let found = 0;
  await scanLogs({
    client: l2Client(chainId),
    addresses: [UNISWAP_V4_POOL_MANAGER],
    abi: POOL_MANAGER_ABI,
    eventName: "Initialize",
    args: { [indexedArg]: addresses },
    range: { fromBlock: from, toBlock: head },
    chunk: POOL_LOG_CHUNK,
    label: `${POOLS_NAME}:${indexedArg}`,
    onWindow: async function commit(logs) {
      const rows = [];
      for (const log of decodeLogs(POOL_MANAGER_ABI, logs)) {
        if (log.eventName !== "Initialize") {
          continue;
        }
        const args = log.args as { id: `0x${string}`; currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address; sqrtPriceX96: bigint; tick: number };
        const sides = sidesOf(args.currency0.toLowerCase(), args.currency1.toLowerCase(), byAddress);
        // A pool needs a quote to be priced. A listed asset against an
        // unlisted token is kept for the record but says nothing about the
        // asset's price; an unlisted token against USDG or WETH is a
        // community pool, priced from the quote like any other.
        if (!sides) {
          continue;
        }
        rows.push({
          id: args.id.toLowerCase(),
          chainId,
          venue: VENUE_V4,
          currency0: args.currency0.toLowerCase(),
          currency1: args.currency1.toLowerCase(),
          fee: args.fee,
          tickSpacing: args.tickSpacing,
          hooks: args.hooks.toLowerCase(),
          assetId: sides.asset?.id ?? null,
          tokenAddress: sides.token ?? (!sides.quote && sides.asset ? (args.currency0.toLowerCase() === sides.asset.address.toLowerCase() ? args.currency1.toLowerCase() : args.currency0.toLowerCase()) : null),
          quoteAssetId: sides.quote?.id ?? null,
          createdBlock: log.blockNumber,
          createdBlockHash: log.blockHash,
          createdTxHash: log.transactionHash,
          createdLogIndex: log.logIndex,
          sqrtPriceX96: args.sqrtPriceX96.toString(),
          tick: args.tick,
          swaps24h: null,
        });
      }
      found += await insertPools(rows);
    },
  });
  return found;
}

// Pools discovered since `from` that were not already on record, announced
// once the job has one good run behind it. A v4 pool is an id inside the
// PoolManager and has no address of its own, so the event names the manager.
export async function announceNewPools(chainId: number, venue: string, from: bigint, to: bigint, symbolById: Map<string, string>): Promise<void> {
  const fresh = await db
    .select()
    .from(dexPools)
    .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true), eq(dexPools.venue, venue), gte(dexPools.createdBlock, from), sql`${dexPools.createdBlock} <= ${to}`));
  const addresses = fresh.flatMap((pool) => pool.tokenAddress ? [pool.tokenAddress] : []);
  const tokens = addresses.length ? await db.select({ address: dexTokens.address, symbol: dexTokens.symbol }).from(dexTokens).where(and(eq(dexTokens.chainId, chainId), inArray(dexTokens.address, addresses))) : [];
  const symbols = new Map(tokens.map((token) => [token.address, token.symbol]));
  await emitEvents(
    fresh.map(function toEvent(pool) {
        return {
          chainId,
          kind: "dex.pool_new" as const,
          assetId: pool.assetId,
          address: pool.poolAddress ?? UNISWAP_V4_POOL_MANAGER.toLowerCase(),
          symbol: pool.assetId ? symbolById.get(pool.assetId) ?? null : symbols.get(pool.tokenAddress ?? "") ?? pool.tokenAddress,
          key: pool.id,
          blockNumber: pool.createdBlock,
          detail: { poolId: pool.id, assetId: pool.assetId, tokenAddress: pool.tokenAddress, venue: pool.venue, fee: pool.fee, quote: pool.quoteAssetId ? symbolById.get(pool.quoteAssetId) : null, hooks: pool.hooks },
          occurredAt: new Date(),
        };
      }),
  );
}

// Uniswap v3 discovery. PoolCreated indexes token0, token1 and fee, so the
// same two-sided currency filter finds every pool that trades a listed asset.
// The filter is expensive for the public RPC — it answers a few hundred
// thousand blocks in seconds and times out over millions — so the scan starts
// narrower than v4's and each run advances a bounded step, leaving the rest to
// the next one rather than outliving its cadence.
async function discoverV3Side(chainId: number, indexedArg: "token0" | "token1", addresses: Address[], from: bigint, to: bigint, byAddress: Map<string, TrackedAsset>): Promise<number> {
  let found = 0;
  await scanLogs({
    client: l2Client(chainId),
    addresses: [UNISWAP_V3_FACTORY],
    abi: UNISWAP_V3_FACTORY_ABI,
    eventName: "PoolCreated",
    args: { [indexedArg]: addresses },
    range: { fromBlock: from, toBlock: to },
    chunk: V3_POOL_LOG_CHUNK,
    label: `${POOLS_V3_NAME}:${indexedArg}`,
    onWindow: async function commit(logs) {
      const rows = [];
      for (const log of decodeLogs(UNISWAP_V3_FACTORY_ABI, logs)) {
        const args = log.args as { token0: Address; token1: Address; fee: number; tickSpacing: number; pool: Address };
        const sides = sidesOf(args.token0.toLowerCase(), args.token1.toLowerCase(), byAddress);
        if (!sides) {
          continue;
        }
        const address = args.pool.toLowerCase();
        rows.push({
          id: address,
          chainId,
          venue: VENUE_V3,
          poolAddress: address,
          currency0: args.token0.toLowerCase(),
          currency1: args.token1.toLowerCase(),
          fee: args.fee,
          tickSpacing: args.tickSpacing,
          hooks: zeroAddress,
          assetId: sides.asset?.id ?? null,
          tokenAddress: sides.token ?? (!sides.quote && sides.asset ? (args.token0.toLowerCase() === sides.asset.address.toLowerCase() ? args.token1.toLowerCase() : args.token0.toLowerCase()) : null),
          quoteAssetId: sides.quote?.id ?? null,
          createdBlock: log.blockNumber,
          createdBlockHash: log.blockHash,
          createdTxHash: log.transactionHash,
          createdLogIndex: log.logIndex,
          swaps24h: null,
        });
      }
      found += await insertPools(rows);
    },
  });
  return found;
}

type SideScan = (chainId: number, tradeable: Address[], from: bigint, to: bigint, byAddress: Map<string, TrackedAsset>) => Promise<number>;

interface VenueDiscovery {
  venue: string;
  job: string;
  // v4's Initialize filter is answered over the whole chain; v3's PoolCreated
  // is not, so its runs advance a bounded step and leave the rest to the next.
  step: bigint | null;
  scanSides: SideScan;
}

async function scanV4Sides(chainId: number, tradeable: Address[], from: bigint, to: bigint, byAddress: Map<string, TrackedAsset>): Promise<number> {
  return (await discoverSide(chainId, "currency0", tradeable, from, to, byAddress)) + (await discoverSide(chainId, "currency1", tradeable, from, to, byAddress));
}

async function scanV3Sides(chainId: number, tradeable: Address[], from: bigint, to: bigint, byAddress: Map<string, TrackedAsset>): Promise<number> {
  return (await discoverV3Side(chainId, "token0", tradeable, from, to, byAddress)) + (await discoverV3Side(chainId, "token1", tradeable, from, to, byAddress));
}

const V4_DISCOVERY: VenueDiscovery = { venue: VENUE_V4, job: POOLS_NAME, step: null, scanSides: scanV4Sides };
const V3_DISCOVERY: VenueDiscovery = { venue: VENUE_V3, job: POOLS_V3_NAME, step: V3_POOL_STEP_BLOCKS, scanSides: scanV3Sides };

// The venues the registry reads, and the one list every venue-shaped answer is
// built from, so `venues` and `discovery` name the same set whether or not a
// venue has a pool on record yet.
const VENUE_DISCOVERY: readonly VenueDiscovery[] = [V4_DISCOVERY, V3_DISCOVERY];

async function discoverVenue(chainId: number, venue: VenueDiscovery, stockOnly = false, initialBlock?: bigint): Promise<RunOutcome> {
  const assets = await activeAssets(chainId);
  const byAddress = new Map(assets.map((asset) => [asset.address.toLowerCase(), asset]));
  // The log filter names every address a kept pool can have on either side:
  // the listed assets, and the quotes, so a community token's pool against
  // USDG or WETH is returned too and classified by sidesOf.
  const tradeable = assets
    .filter((asset) => (!stockOnly || asset.assetType === "stock_token") && (asset.assetType === "stock_token" || asset.assetType === "bridged" || asset.assetType === "stablecoin" || asset.assetType === "wrapped_native"))
    .map((asset) => asset.address as Address);
  const client = l2Client(chainId);
  const head = (await client.getBlockNumber()) - CONFIRMATIONS;
  const checkpoint = await readCheckpoint(`${venue.job}:${chainId}`);
  const from = checkpoint ? checkpoint.blockNumber + BigInt(1) : initialBlock ?? backfillStart();
  if (from > head) {
    return { rows: 0, detail: { venue: venue.venue, head: head.toString() } };
  }
  const to = venue.step !== null && from + venue.step < head ? from + venue.step : head;
  // A pool found while the scan is still crossing history was created months
  // ago; only a scan that has caught up to head can call a pool new. A venue
  // whose backfill takes many runs would otherwise announce its whole history
  // one window at a time, stamped as happening now.
  const caughtUp = checkpoint !== null && !stillFilling(head - checkpoint.blockNumber);
  const announcing = caughtUp && (await lastFinishedRunOf(venue.job))?.ok === true;
  const found = await venue.scanSides(chainId, tradeable, from, to, byAddress);
  if (!stockOnly && announcing) {
    await announceNewPools(chainId, venue.venue, from, to, new Map(assets.map((asset) => [asset.id, asset.symbol])));
  }
  // Retrying this range also retries event insertion. Stable pool keys deduplicate it.
  await writeCheckpoint(`${venue.job}:${chainId}`, chainId, { blockNumber: to, blockHash: await blockHash(client, to) });
  return { rows: found, detail: { venue: venue.venue, from: from.toString(), to: to.toString(), behind: (head - to).toString(), newPools: found } };
}

export async function backfillStockPairings(chainId: number): Promise<RunOutcome> {
  // Recover recent pairings first while the independent history cursors fill.
  let recent = 0;
  if (!(await readCheckpoint(`stock-pairs-recent:${chainId}`))) {
    const head = await l2Client(chainId).getBlockNumber();
    const from = head > BigInt(5_000_000) ? head - BigInt(5_000_000) : backfillStart();
    recent = (await discoverVenue(chainId, { ...V4_DISCOVERY, job: "stock-pairs-recent" }, true, from)).rows;
  }
  const v4 = await discoverVenue(chainId, { ...V4_DISCOVERY, job: "stock-pairs-v4", step: BigInt(5_000_000) }, true);
  const v3 = await discoverVenue(chainId, { ...V3_DISCOVERY, job: "stock-pairs-v3", step: V3_POOL_STEP_BLOCKS }, true);
  return { rows: recent + v4.rows + v3.rows, detail: { v4: v4.detail, v3: v3.detail } };
}

export function discoverPools(chainId: number): Promise<RunOutcome> {
  return discoverVenue(chainId, V4_DISCOVERY);
}

export function discoverV3Pools(chainId: number): Promise<RunOutcome> {
  return discoverVenue(chainId, V3_DISCOVERY);
}

// price of currency1 per currency0 from sqrtPriceX96, corrected for decimals.
function priceOneInZero(sqrtPriceX96: bigint, decimals0: number, decimals1: number): number {
  const ratio = Number(sqrtPriceX96) / Q96;
  return ratio * ratio * 10 ** (decimals0 - decimals1);
}

interface Priced {
  priceInQuote: number | null;
  priceUsd: number | null;
}

// Price of the asset in its quote, then in dollars when the quote is USDG
// or WETH with a feed price of its own.
function priceOf(pool: PoolRow, sqrtPriceX96: bigint, asset: PricedSide, quote: TrackedAsset | null, usdOfQuote: number | null): Priced {
  if (!quote) {
    return { priceInQuote: null, priceUsd: null };
  }
  const assetIsZero = pool.currency0 === asset.address.toLowerCase();
  const oneInZero = priceOneInZero(sqrtPriceX96, assetIsZero ? asset.decimals : quote.decimals, assetIsZero ? quote.decimals : asset.decimals);
  const priceInQuote = assetIsZero ? oneInZero : oneInZero === 0 ? null : 1 / oneInZero;
  if (priceInQuote === null || !Number.isFinite(priceInQuote)) {
    return { priceInQuote: null, priceUsd: null };
  }
  return { priceInQuote, priceUsd: usdOfQuote === null ? null : priceInQuote * usdOfQuote };
}

// One read per quote token: what the v4 PoolManager holds of it, in dollars.
// Every v4 pool's quote side is somewhere inside this, so a pool claiming more
// is claiming something the venue does not have.
async function venueHoldsUsd(chainId: number, assets: TrackedAsset[], usd: Map<string, number>, client = l2Client(chainId)): Promise<Map<string, number>> {
  const quotes = assets.filter((asset) => usd.has(asset.id));
  if (quotes.length === 0) {
    return new Map();
  }
  const calls: MulticallCall[] = quotes.map(function balanceCall(quote) {
    return { address: quote.address, abi: erc20Abi, functionName: "balanceOf", args: [UNISWAP_V4_POOL_MANAGER] };
  });
  const results = await multicall(client, calls);
  const holdings = new Map<string, number>();
  for (const [index, quote] of quotes.entries()) {
    const result = results[index];
    const dollars = usd.get(quote.id);
    if (result?.status === "success" && typeof result.result === "bigint" && dollars !== undefined) {
      holdings.set(quote.id, usdOf(result.result, quote, dollars));
    }
  }
  return holdings;
}

// Every v3 pool in this pass, by its own balance of the quote token. One extra
// call per v3 pool, and the only exact reserve figure either venue offers.
async function v3QuoteReserves(chainId: number, pools: PoolRow[], byId: Map<string, TrackedAsset>, usd: Map<string, number>, client = l2Client(chainId)): Promise<Map<string, number>> {
  const reserves = new Map<string, number>();
  const wanted = pools.filter((pool) => pool.venue !== VENUE_V4 && pool.quoteAssetId !== null);
  if (wanted.length === 0) {
    return reserves;
  }
  const calls: MulticallCall[] = wanted.map(function balanceCall(pool) {
    const quote = byId.get(pool.quoteAssetId as string);
    return { address: (quote?.address ?? zeroAddress) as Address, abi: erc20Abi, functionName: "balanceOf", args: [(pool.poolAddress ?? pool.id) as Address] };
  });
  const results = await multicall(client, calls);
  for (const [index, pool] of wanted.entries()) {
    const result = results[index];
    const quote = byId.get(pool.quoteAssetId as string);
    const dollars = quote ? usd.get(quote.id) : undefined;
    if (result?.status === "success" && typeof result.result === "bigint" && quote && dollars !== undefined) {
      reserves.set(pool.id, usdOf(result.result, quote, dollars));
    }
  }
  return reserves;
}

async function usdPerQuote(assets: TrackedAsset[]): Promise<Map<string, number>> {
  const quotes = assets.filter((asset) => asset.assetType === "stablecoin" || asset.assetType === "wrapped_native");
  const usd = new Map<string, number>();
  for (const quote of quotes) {
    if (quote.assetType === "stablecoin") {
      usd.set(quote.id, 1);
      continue;
    }
    const [state] = await db.select({ feedPrice: registryAssetState.feedPrice, feedCheckedAt: registryAssetState.feedCheckedAt, feedStale: registryAssetState.feedStale })
      .from(registryAssetState).where(eq(registryAssetState.assetId, quote.id)).limit(1);
    const age = state?.feedCheckedAt ? Date.now() - state.feedCheckedAt.getTime() : Infinity;
    const price = Number(state?.feedPrice);
    if (age >= 0 && age <= 120_000 && state?.feedStale === false && Number.isFinite(price) && price > 0) {
      usd.set(quote.id, price);
    }
  }
  return usd;
}

// The deepest pool of any venue, in dollars it takes to move 1%: what the
// asset's published DEX price, liquidity and premium are read from.
interface BestPool {
  pool: PoolRow;
  liquidity: bigint;
  depthUsd: number;
  priceUsd: number;
}

async function announcePremium(asset: TrackedAsset, before: string | null, after: number | null, best: BestPool): Promise<void> {
  if (after === null || best.depthUsd < PREMIUM_DEPTH_FLOOR_USD) {
    return;
  }
  const wasOutside = before !== null && Math.abs(Number(before)) > PREMIUM_EVENT_PCT;
  const isOutside = Math.abs(after) > PREMIUM_EVENT_PCT;
  if (wasOutside || !isOutside) {
    return;
  }
  await emitEvents([
    {
      chainId: asset.chainId,
      kind: "dex.premium",
      assetId: asset.id,
      address: asset.address.toLowerCase(),
      symbol: asset.symbol,
      key: `${best.pool.id}:${new Date().toISOString().slice(0, 13)}`,
      detail: { premiumPct: Number(after.toFixed(2)), poolId: best.pool.id, venue: best.pool.venue, depthUsd: Number(best.depthUsd.toFixed(2)), liquidity: best.liquidity.toString() },
      occurredAt: new Date(),
    },
  ]);
}

// Price and depth, two calls per pool whichever venue it is on, in the order
// the reader below unpacks them. v3 slot0 returns seven values and v4's four,
// but sqrtPriceX96 and tick are the first two of both.
function stateCalls(pool: PoolRow): MulticallCall[] {
  if (pool.venue === VENUE_V4) {
    const poolId = pool.id as `0x${string}`;
    return [
      { address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: "getSlot0", args: [poolId] },
      { address: UNISWAP_V4_STATE_VIEW, abi: STATE_VIEW_ABI, functionName: "getLiquidity", args: [poolId] },
    ];
  }
  // Every venue but v4 is a contract per pool, and discovery writes that
  // contract as both the row id and pool_address. Branching on the venue
  // rather than on the address keeps a row with a null address out of the v4
  // branch, where its 20-byte id would fail to encode as a bytes32 pool id and
  // take the whole multicall batch down with it.
  const address = (pool.poolAddress ?? pool.id) as Address;
  return [
    { address, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" },
    { address, abi: UNISWAP_V3_POOL_ABI, functionName: "liquidity" },
  ];
}

// The pool it takes the most dollars to move, of any venue, sets the asset's
// DEX price and its premium to the feed, so a v3 pool deeper than every v4
// pool wins — and a pool whose quote has no dollar price is not a candidate.
// The priced side of a pool: the listed asset, or the community token once
// its contract has been read for decimals. Null means "not priceable yet".
function pricedSideOf(pool: PoolRow, byId: Map<string, TrackedAsset>, tokens: Map<string, DexToken>): PricedSide | null {
  if (pool.assetId) {
    const asset = byId.get(pool.assetId);
    return asset ? { address: asset.address.toLowerCase(), decimals: asset.decimals } : null;
  }
  if (!pool.tokenAddress) {
    return null;
  }
  const token = tokens.get(pool.tokenAddress);
  return token && token.decimals !== null ? { address: token.address, decimals: token.decimals } : null;
}

async function knownTokens(chainId: number, addresses: string[]): Promise<Map<string, DexToken>> {
  if (!addresses.length) return new Map();
  const rows = await db.select().from(dexTokens).where(and(eq(dexTokens.chainId, chainId), isNotNull(dexTokens.decimals), inArray(dexTokens.address, addresses)));
  return new Map(rows.map((row) => [row.address, row]));
}

export async function refreshPoolState(chainId: number, options: { poolIds?: readonly string[]; client?: PublicClient; force?: boolean } = {}): Promise<RunOutcome> {
  const startedAt = Date.now();
  let rpcMethods = 0;
  const client = options.client ?? getMarketReadClient(chainId, async () => {
    const verdict = await checkMarketRpcBudget("state");
    if (verdict.ok) rpcMethods++;
    return verdict;
  });
  const assets = await activeAssets(chainId);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usd = await usdPerQuote(assets);
  const pools = options.poolIds
    ? (options.poolIds.length ? await db.select().from(dexPools).where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true), inArray(dexPools.id, [...options.poolIds].slice(0, 4)))) : []).filter((pool) => stateRetryIsDue(pool.stateRetryAt) && (options.force || !stateReadIsCurrent(pool.stateCheckedAt)))
    : await duePoolStateReads(chainId);
  if (pools.length === 0) {
    return { rows: 0, detail: { pools: 0 } };
  }
  const tokens = await knownTokens(chainId, pools.flatMap((pool) => pool.tokenAddress ? [pool.tokenAddress] : []));
  const calls = pools.flatMap(stateCalls);
  let results: MulticallResult[];
  try { results = await multicall(client, calls); } catch {
    await deferPoolStateReads(chainId, pools.map((pool) => pool.id));
    throw new Error("Pool state RPC failed; previous observations retained and retry delayed");
  }
  // What the v4 singleton actually holds of each quote token, and what each v3
  // pool holds of its own: the two reads that keep a depth figure inside what
  // exists on the chain.
  let venueHoldings: Map<string, number>;
  let reserves: Map<string, number>;
  try {
    venueHoldings = pools.some((pool) => pool.venue === VENUE_V4) ? await venueHoldsUsd(chainId, assets, usd, client) : new Map();
    reserves = await v3QuoteReserves(chainId, pools, byId, usd, client);
  } catch {
    await deferPoolStateReads(chainId, pools.map((pool) => pool.id));
    throw new Error("Pool reserve RPC failed; previous observations retained and retry delayed");
  }
  const best = new Map<string, BestPool>();
  let updated = 0;
  const failed: string[] = [];
  const now = new Date();
  for (const [index, pool] of pools.entries()) {
    const slot = results[index * 2];
    const liq = results[index * 2 + 1];
    if (slot?.status !== "success" || !Array.isArray(slot.result) || liq?.status !== "success" || typeof liq.result !== "bigint") {
      failed.push(pool.id);
      continue;
    }
    const [sqrtPriceX96, tick] = slot.result as [bigint, number, number, number];
    const side = pricedSideOf(pool, byId, tokens);
    const quote = pool.quoteAssetId ? (byId.get(pool.quoteAssetId) ?? null) : null;
    const usdOfQuote = quote ? (usd.get(quote.id) ?? null) : null;
    if (quote && usdOfQuote !== null && !(pool.venue === VENUE_V4 ? venueHoldings.has(quote.id) : reserves.has(pool.id))) {
      failed.push(pool.id);
      continue;
    }
    // Depth needs only the quote, so a pool whose token has not been read
    // yet still gets its reserves, its depth and its read time: the tier
    // rule can file an empty one away, and the pass moves on to the next
    // batch instead of returning to the same unreadable pools forever. The
    // price waits for the token's decimals.
    const priced: Priced = side ? priceOf(pool, sqrtPriceX96, side, quote, usdOfQuote) : { priceInQuote: null, priceUsd: null };
    const reserve = reserves.get(pool.id);
    // A v3 pool holds its own tokens, so its balance of the quote is the
    // reserve itself. A v4 pool's funds are in the shared PoolManager, so the
    // 1% estimate stands in, bounded by what that PoolManager holds.
    let depthUsd: number | null = reserve ?? null;
    if (reserve === undefined && pool.venue === VENUE_V4 && quote && usdOfQuote !== null) {
      depthUsd = withinVenueHoldings(onePctDepthUsd(pool.currency1, quote, sqrtPriceX96, liq.result, usdOfQuote), venueHoldings.get(quote.id) ?? null);
    }
    await db
      .update(dexPools)
      .set({
        sqrtPriceX96: sqrtPriceX96.toString(),
        tick,
        liquidity: liq.result.toString(),
        depthUsd: depthUsd === null ? null : depthUsd.toFixed(2),
        priceInQuote: priced.priceInQuote === null ? null : priced.priceInQuote.toString(),
        priceUsd: priced.priceUsd === null ? null : priced.priceUsd.toString(),
        stateCheckedAt: now,
        stateAttemptedAt: now,
        stateRetryAt: null,
        stateFailures: 0,
        // Depth is enough on its own to make a pool worth watching again.
        tier: depthUsd !== null && depthUsd >= ACTIVE_DEPTH_USD ? "active" : pool.tier,
      })
      .where(and(eq(dexPools.id, pool.id), eq(dexPools.canonical, true)));
    updated += 1;
    if (pool.assetId && priced.priceUsd !== null && depthUsd !== null && depthUsd > 0) {
      const current = best.get(pool.assetId);
      if (!current || depthUsd > current.depthUsd) {
        best.set(pool.assetId, { pool, liquidity: liq.result, depthUsd, priceUsd: priced.priceUsd });
      }
    }
  }
  await deferPoolStateReads(chainId, failed, now);
  let priced = 0;
  for (const [assetId, entry] of best) {
    const asset = byId.get(assetId);
    if (!asset) {
      continue;
    }
    const state = await db.select({ feedPrice: registryAssetState.feedPrice, premium: registryAssetState.dexPremiumPct }).from(registryAssetState).where(eq(registryAssetState.assetId, assetId)).limit(1);
    const feed = state[0]?.feedPrice ? Number(state[0].feedPrice) : null;
    const premium = feed && feed > 0 ? ((entry.priceUsd - feed) / feed) * 100 : null;
    await patchState(asset, {
      dexPoolId: entry.pool.id,
      dexVenue: entry.pool.venue,
      dexPriceUsd: entry.priceUsd.toString(),
      dexLiquidity: entry.liquidity.toString(),
      dexDepthUsd: entry.depthUsd.toFixed(2),
      dexPremiumPct: premium === null ? null : premium.toFixed(4),
      dexCheckedAt: now,
    });
    await announcePremium(asset, state[0]?.premium ?? null, premium, entry);
    priced += 1;
  }
  return { rows: updated, detail: { selected: pools.length, sampled: updated, failed: failed.length, durationMs: Date.now() - startedAt, rpcMethods: options.client ? null : rpcMethods, pools: pools.length, priced } };
}

export { scanLiveMarketSwaps as scanSwaps } from "./market-swaps";

// Deepest first in dollars. Pools the state read has not reached carry no
// depth at all and belong last, not first, which is where Postgres puts nulls
// in a descending sort by default.
export async function poolsFor(assetId: string, limit = 20): Promise<PoolRow[]> {
  return db.select({ ...getTableColumns(dexPools), ...poolSwapColumns, quoteObservation: poolQuoteObservation, stateObservationCurrent: poolStateCurrent.mapWith(Boolean) })
    .from(dexPools)
    .leftJoin(marketPoolSwapMetrics, poolSwapMembership)
    .leftJoin(marketSwapIndexState, eq(marketSwapIndexState.chainId, dexPools.chainId))
    .where(and(eq(dexPools.assetId, assetId), eq(dexPools.canonical, true)))
    .orderBy(poolOrder("depth"))
    .limit(Math.max(1, Math.min(500, limit)));
}

export async function deepestTokenPool(chainId: number, address: string): Promise<PoolRow | null> {
  const [pool] = await db.select({ ...getTableColumns(dexPools), ...poolSwapColumns, quoteObservation: poolQuoteObservation, stateObservationCurrent: poolStateCurrent.mapWith(Boolean) }).from(dexPools)
    .leftJoin(marketPoolSwapMetrics, poolSwapMembership)
    .leftJoin(marketSwapIndexState, eq(marketSwapIndexState.chainId, dexPools.chainId))
    .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true), eq(dexPools.tokenAddress, address)))
    .orderBy(poolOrder("depth")).limit(1);
  if (!pool) return null;
  if (pool.stateObservationCurrent && stateReadIsCurrent(pool.stateCheckedAt)) return pool;
  return { ...pool, priceUsd: null, priceInQuote: null, depthUsd: null, sqrtPriceX96: null, tick: null, liquidity: null };
}

export interface VenueScan {
  venue: string;
  // Discovery has read this venue at least once, so an empty pool list means
  // "none found" rather than "not looked yet". A checkpoint is the evidence
  // that a scan happened; the last run's outcome is not, because one failed or
  // in-flight run would otherwise erase thousands of pools already on record.
  scanned: boolean;
  block: bigint | null;
  head: bigint | null;
  headAt: Date | null;
  behind: bigint | null;
  filling: boolean;
}

// How far each venue's discovery has read, so a page or a route can say that a
// missing pool may simply be one the scan has not reached. Head comes from the
// recorded chain health rather than an RPC call, since this is read per page.
export async function venueScans(chainId: number): Promise<VenueScan[]> {
  const recorded = await recordedHead(chainId);
  const head = recorded?.block ?? null;
  return Promise.all(
    VENUE_DISCOVERY.map(async function scanOf(venue): Promise<VenueScan> {
      const checkpointName = process.env.FLETCH_DISCOVERY_WORKER === "1" ? `discover-all:${venue.venue}:${chainId}` : `${venue.job}:${chainId}`;
      const [run, checkpoint] = await Promise.all([lastRunOf(venue.job), readCheckpoint(checkpointName)]);
      const block = checkpoint?.blockNumber ?? null;
      const behind = block !== null && head !== null ? head - block : null;
      return { venue: venue.venue, scanned: block !== null || run?.ok === true, block, head, headAt: recorded?.at ?? null, behind, filling: stillFilling(behind) };
    }),
  );
}

export interface VenueTotals {
  venue: string;
  pools: number;
  priced: number;
  depthUsd: number | null;
  swaps24h: number | null;
  volumeUsd24h: number | null;
  assetsPriced: number;
  checkedAt: Date | null;
}

// What each venue contributes: how many pools trade a listed asset, how many
// of those the state read has put a dollar price on and how deep they are, the
// swaps counted over the rollup window, and how many assets take their premium
// from a pool here (the deepest pool in dollars wins, whichever venue it is
// on). Every venue read gets a row, whether or not it has a pool yet, so this
// list and venueScans name the same set.
export interface SwapCoverage {
  // UTC date of the exact scan boundary, retained for API compatibility.
  newestDay: string | null;
  // Pools with complete, fresh rolling metrics.
  pools: number;
  // A complete rolling window through a block no more than two minutes old.
  current: boolean;
  asOf: Date | null;
  windowStart: Date | null;
}

// What the swap scan has actually finished. A 24h volume of zero is a claim
// about the chain; "the scan has not reached today" is a claim about us, and
// the page has to be able to tell them apart.
export async function swapCoverage(chainId: number): Promise<SwapCoverage> {
  const reading = await readSwapIndexer(chainId);
  return {
    newestDay: reading.newestCountedAt?.slice(0, 10) ?? null,
    pools: reading.current ? reading.tiers.reduce((total, tier) => total + tier.complete24hPools, 0) : 0,
    current: reading.current,
    asOf: reading.newestCountedAt ? new Date(reading.newestCountedAt) : null,
    windowStart: reading.windowStartAt ? new Date(reading.windowStartAt) : null,
  };
}

export async function venueTotals(chainId: number): Promise<VenueTotals[]> {
  const [totals, leaders] = await Promise.all([
    db
      .select({
        venue: dexPools.venue,
        pools: count(),
        priced: sql<number>`count(*) filter(where ${dexPools.priceUsd} is not null and ${poolStateCurrent})::integer`,
        depthUsd: sql<string | null>`sum(case when ${poolStateCurrent} then ${dexPools.depthUsd} end)`,
        swaps24h: sql<number | null>`case when bool_and(${poolSwapColumns.metricsCurrent}) then sum(${poolSwapColumns.swaps24h}) end`,
        volumeUsd24h: sql<string | null>`case when bool_and(${poolSwapColumns.metricsCurrent} and ${marketPoolSwapMetrics.volumeUsd} is not null) then sum(${poolSwapColumns.volumeUsd24h}) end`,
        checkedAt: max(dexPools.stateCheckedAt),
      })
      .from(dexPools)
      .leftJoin(marketPoolSwapMetrics, poolSwapMembership)
      .leftJoin(marketSwapIndexState, eq(marketSwapIndexState.chainId, dexPools.chainId))
      .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true)))
      .groupBy(dexPools.venue),
    db
      .select({ venue: dexPools.venue, assets: count() })
      .from(registryAssetState)
      .innerJoin(dexPools, eq(dexPools.id, registryAssetState.dexPoolId))
      .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true)))
      .groupBy(dexPools.venue),
  ]);
  const assetsByVenue = new Map(leaders.map((row) => [row.venue, row.assets]));
  const byVenue = new Map(totals.map((row) => [row.venue, row]));
  return VENUE_DISCOVERY.map(function forVenue(venue): VenueTotals {
    const row = byVenue.get(venue.venue);
    return {
      venue: venue.venue,
      pools: row?.pools ?? 0,
      priced: row?.priced ?? 0,
      depthUsd: row?.depthUsd == null ? null : Number(row.depthUsd),
      swaps24h: row?.swaps24h == null ? null : Number(row.swaps24h),
      volumeUsd24h: row?.volumeUsd24h == null ? null : Number(row.volumeUsd24h),
      assetsPriced: assetsByVenue.get(venue.venue) ?? 0,
      checkedAt: row?.checkedAt ?? null,
    };
  }).sort((a, b) => b.pools - a.pools);
}

const TOKENS_NAME = "dex-tokens";
export interface TokenRefreshOptions {
  poolCandidatesOnly?: boolean;
  client?: PublicClient;
  now?: () => Date;
  limit?: number;
  workMs?: number;
}

export async function refreshDexTokens(chainId: number, priorityAddresses?: readonly string[], options: TokenRefreshOptions = {}): Promise<RunOutcome> {
  const clock = options.now ?? (() => new Date());
  const started = clock();
  const priority = priorityAddresses ? [...new Set(priorityAddresses.map((address) => address.toLowerCase()).filter((address) => /^0x[0-9a-f]{40}$/.test(address)))].slice(0, IMMEDIATE_TOKEN_PROBE_LIMIT) : null;
  if (priority?.length === 0) return { rows: 0, detail: { selected: 0 } };
  const workMs = options.workMs === undefined ? TOKEN_WORK_MS : Math.max(0, Math.min(90_000, Number.isFinite(options.workMs) ? options.workMs : 0));
  const deadline = started.getTime() + workMs;
  const due = await dueTokenReads(chainId, started, priority, options.limit ?? (priority ? IMMEDIATE_TOKEN_PROBE_LIMIT : TOKEN_READ_BATCH), options.poolCandidatesOnly);
  const verified = due.length > 0 ? await verifiedAssetIndex(chainId) : [];
  const client = due.length > 0 ? (options.client ?? getMetadataClient(chainId, checkRpcBudget)) : null;
  let written = 0;
  let refused = 0;
  let failed = 0;
  for (let start = 0; start < due.length && clock().getTime() < deadline; start += TOKEN_GROUP) {
    const group = due.slice(start, start + TOKEN_GROUP);
    const calls: MulticallCall[] = group.flatMap(function callsFor(address) {
      const target = address as Address;
      return [
        { address: target, abi: erc20Abi, functionName: "symbol" },
        { address: target, abi: erc20Abi, functionName: "name" },
        { address: target, abi: erc20Abi, functionName: "decimals" },
        { address: target, abi: erc20Abi, functionName: "totalSupply" },
        { address: target, abi: erc20Abi, functionName: "balanceOf", args: [DEAD_ADDRESS] },
        { address: target, abi: erc20Abi, functionName: "balanceOf", args: [zeroAddress] },
      ];
    });
    const results = await multicall(client!, calls);
    const observedAt = clock();
    const failures = metadataFailureSummary(results, calls);
    if (failures.aggregateFailures > 0 || failures.contractFailures > 0) {
      logEvent("registry", { event: "dex-token-call-failures", job: TOKENS_NAME, ...failures });
    }
    if (results.every((result) => result.status !== "success") && failures.aggregateFailures > 0) {
      refused += group.length;
      if (priority) {
        await db.update(dexTokens).set({ checkedAt: observedAt, error: "RPC refused the metadata probe; retry required" })
          .where(and(eq(dexTokens.chainId, chainId), inArray(dexTokens.address, group)));
      }
      break;
    }
    const saved = await writeTokenReads(chainId, group, results, verified, observedAt, client!, clock, deadline);
    written += saved.written;
    failed += saved.failed;
  }
  const backlog = await tokenMetadataBacklog(chainId, clock(), priority, options.poolCandidatesOnly);
  logEvent("registry", { event: "dex-tokens-read", job: TOKENS_NAME, read: written, failed, refused, backlog });
  if (refused > 0 && !priority) throw new Error(`Metadata RPC refused a ${refused}-token batch; ${written} saved; ${backlog.due} still due`);
  return { rows: written, error: failed + refused > 0 ? `${failed + refused} token metadata reads failed` : undefined, detail: { failed, tokens: backlog.total, selected: due.length, refused, metadataBacklog: backlog, workBudgetMs: workMs } };
}

export async function probePendingDiscoveryTokens(chainId: number, probe: (chainId: number, addresses: readonly string[]) => Promise<RunOutcome> = refreshDexTokens): Promise<RunOutcome> {
  const rows = await db.select({ address: dexTokens.address }).from(dexTokens)
    .where(and(eq(dexTokens.chainId, chainId), "orphaned" in dexTokens ? sql`not orphaned` : undefined, isNull(dexTokens.checkedAt)))
    .orderBy(sql`${dexTokens.firstSeenAt} desc`, dexTokens.address).limit(IMMEDIATE_TOKEN_PROBE_LIMIT);
  if (rows.length === 0) return { rows: 0, detail: { due: 0 } };
  return probe(chainId, rows.map((row) => row.address));
}

// symbol, name, decimals, totalSupply, and the balance at each burn address.
const TOKEN_CALLS = 6;
// The address every chain uses to mean "gone"; it has no private key.
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

async function writeTokenReads(chainId: number, group: string[], results: MulticallResult[], verified: VerifiedAsset[], observedAt: Date, client: PublicClient, clock: () => Date, deadline: number): Promise<{ written: number; failed: number }> {
  let written = 0;
  let failed = 0;
  for (const [index, address] of group.entries()) {
    if (clock().getTime() >= deadline) break;
    const [code] = await Promise.allSettled([client.getBytecode({ address: address as Address })]);
    const now = clock();
    const [symbol, name, decimals, supply, dead, zero] = results.slice(index * TOKEN_CALLS, index * TOKEN_CALLS + TOKEN_CALLS);
    const readDecimals = decimals.status === "success" && typeof decimals.result === "number" ? decimals.result : null;
    // Both burn addresses must answer, or the burned figure is unknown and
    // market cap is not published: a partial read would price supply that may
    // already be out of reach as if it were circulating.
    const burned = dead.status === "success" && zero.status === "success" && typeof dead.result === "bigint" && typeof zero.result === "bigint" ? dead.result + zero.result : null;
    let error: string | null = null;
    if (readDecimals === null) error = "the contract did not answer decimals()";
    else if (code.status === "rejected") error = "bytecode probe failed; retry required";
    else if (!code.value || code.value === "0x") error = "the address has no bytecode";
    else if (symbol.status !== "success" || name.status !== "success") error = "token name or symbol call failed; retry required";
    else if (supply.status !== "success" || burned === null) error = "supply or burn balance call failed; retry required";
    const row = {
      id: `${chainId}:${address}`,
      chainId,
      address,
      symbol: symbol.status === "success" && typeof symbol.result === "string" ? symbol.result.slice(0, 32) : null,
      name: name.status === "success" && typeof name.result === "string" ? name.result.slice(0, 96) : null,
      decimals: readDecimals,
      totalSupplyRaw: supply.status === "success" && typeof supply.result === "bigint" ? supply.result.toString() : null,
      // How this address reached the table. A token a user pasted into a
      // watcher keeps that provenance; the scan does not claim it found it.
      source: "factory_scan",
      bytecodePresent: code.status === "fulfilled" ? Boolean(code.value && code.value !== "0x") : null,
      burnedRaw: burned === null ? null : burned.toString(),
      supplyCheckedAt: supply.status === "success" ? observedAt : null,
      checkedAt: now,
      error,
    };
    await db
      .insert(dexTokens)
      .values(row)
      .onConflictDoUpdate({
        target: dexTokens.id,
        set: {
          symbol: row.symbol,
          name: row.name,
          decimals: row.decimals,
          totalSupplyRaw: row.totalSupplyRaw,
          burnedRaw: row.burnedRaw,
          supplyCheckedAt: row.supplyCheckedAt,
          bytecodePresent: row.bytecodePresent,
          ...(row.bytecodePresent === true && row.decimals !== null ? { orphaned: false } : {}),
          checkedAt: now,
          error: row.error,
        },
      });
    written += 1;
    if (error !== null) failed++;
    await noteCollision(chainId, row, verified, now);
  }
  return { written, failed };
}

interface ReadToken {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
}

// Folded against the confirmed listings, so a token whose ticker reads as a
// Stock Token's is on the lookalikes table the moment it is read, not only
// when Blockscout's ticker search happens to offer it.
async function noteCollision(chainId: number, token: ReadToken, verified: VerifiedAsset[], now: Date): Promise<void> {
  const symbol = foldTicker(token.symbol);
  const name = foldTicker(token.name);
  if (!symbol && !name) {
    return;
  }
  const match = verified.find((asset) => (symbol && symbol === foldTicker(asset.symbol)) || (name && name === foldTicker(asset.name)));
  if (!match || match.address.toLowerCase() === token.address.toLowerCase()) {
    return;
  }
  const asset: TrackedAsset = { id: match.id, chainId, address: match.address as `0x${string}`, symbol: match.symbol, name: match.name, assetType: match.assetType, decimals: match.decimals };
  await recordFoldedLookalike(chainId, { ...token, holders: null }, asset, now);
}

export type PoolKind = "all" | "listed" | "community" | "lookalike";
export type PoolSort = "traction" | "depth" | "volume" | "swaps" | "newest";

export type PoolTierFilter = PoolTier | "all";

export interface PoolPageQuery {
  chainId: number;
  limit: number;
  offset: number;
  kind: PoolKind;
  // Which tiers to show; the default view is the active ones.
  tier: PoolTierFilter;
  sort: PoolSort;
  venue: string | null;
  // A ticker or name fragment, matched against listed symbols and community
  // token symbols and names.
  q: string | null;
  // Dollars of depth a pool needs to appear in a default view, and whether an
  // operator has hidden its token. Both are lifted by `tier=all`, which is the
  // archive: nothing is deleted at any floor.
  floorUsd: number;
}

export interface PoolPage {
  pools: PoolRow[];
  tokens: Map<string, DexToken>;
  total: number;
}

function poolOrder(sort: PoolSort): SQL {
  const stateFresh = poolStateCurrent;
  const depth = sql`case when ${stateFresh} then ${dexPools.depthUsd} else null end`;
  const liquidity = sql`case when ${stateFresh} then ${dexPools.liquidity} else null end`;
  const volume = poolSwapColumns.volumeUsd24h;
  const swaps = poolSwapColumns.swaps24h;
  switch (sort) {
    // What a pool has actually done, in the order the evidence is worth
    // trusting: dollars traded, then the quote side someone could trade
    // against, then the count of trades, then age, so a pool that has done
    // nothing cannot reach the top of the table by being new.
    case "volume":
      return sql`${volume} desc nulls last, ${dexPools.id} asc`;
    case "traction":
      return sql`${volume} desc nulls last, ${depth} desc nulls last, ${swaps} desc nulls last, ${dexPools.firstSeenAt} asc, ${dexPools.id} asc`;
    case "swaps":
      return sql`${swaps} desc nulls last, ${depth} desc nulls last, ${dexPools.id} asc`;
    case "newest":
      return sql`${dexPools.createdBlock} desc nulls last, ${dexPools.id} asc`;
    default:
      return sql`${depth} desc nulls last, ${liquidity} desc nulls last, ${dexPools.id} asc`;
  }
}

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL_ID = /^0x[0-9a-f]{64}$/;

// What the search box was given. People arrive holding a pair address from
// another site, so an address is answered as an address rather than searched
// for as a name.
export type SearchShape = "address" | "poolId" | "text";

export function searchShapeOf(term: string): SearchShape {
  const value = term.trim().toLowerCase();
  if (ADDRESS.test(value)) {
    return "address";
  }
  return POOL_ID.test(value) ? "poolId" : "text";
}

// Every pool on record, listed and community alike, one page at a time. The
// search matches a listed asset's ticker exactly or a community token's
// symbol or name by prefix, so "PIPE" finds PIPEDOG and "TSLA" finds every
// TSLA pool without also finding every pool whose name contains the letters.
// One box, five kinds of answer: a token symbol, a token name, a token
// contract, a v3 pool contract, and a v4 pool id. Null when nothing on record
// matches, which the page turns into a sentence naming what was checked.
async function searchFilter(query: PoolPageQuery, listedIdsFor: (ticker: string) => Promise<string[]>): Promise<(ReturnType<typeof or> & object) | null> {
  const raw = (query.q ?? "").trim();
  const shape = searchShapeOf(raw);
  if (shape === "poolId") {
    return or(eq(dexPools.id, raw.toLowerCase())) as ReturnType<typeof or> & object;
  }
  if (shape === "address") {
    const address = raw.toLowerCase();
    // An address is either the token being traded or the pool contract itself.
    return or(eq(dexPools.tokenAddress, address), eq(dexPools.poolAddress, address), eq(dexPools.id, address)) as ReturnType<typeof or> & object;
  }
  const term = raw.replace(/[%_]/g, "").slice(0, 32);
  const listedIds = await listedIdsFor(term.toUpperCase());
  const matching = await db
    .select({ address: dexTokens.address })
    .from(dexTokens)
    .where(and(eq(dexTokens.chainId, query.chainId), or(sql`${dexTokens.symbol} ilike ${term + "%"}`, sql`${dexTokens.name} ilike ${term + "%"}`)))
    .limit(500);
  const tokenAddresses = matching.map((row) => row.address);
  const either = [];
  if (listedIds.length > 0) {
    either.push(inArray(dexPools.assetId, listedIds));
  }
  if (tokenAddresses.length > 0) {
    either.push(inArray(dexPools.tokenAddress, tokenAddresses));
  }
  return either.length === 0 ? null : (or(...either) as ReturnType<typeof or> & object);
}

export interface SymbolCluster {
  symbol: string;
  // Distinct contracts answering to that symbol, including the one at the top
  // of the table.
  contracts: number;
}

// How many different contracts call themselves this. Nothing about the answer
// says which one is real; the table's own figures make that case, and a token
// nobody has vouched for is never labelled the official one.
export async function symbolCluster(chainId: number, term: string): Promise<SymbolCluster | null> {
  const wanted = term.trim().replace(/^\$/, "");
  if (wanted === "" || searchShapeOf(wanted) !== "text") {
    return null;
  }
  const rows = await db
    .select({ contracts: sql<number>`count(distinct ${dexTokens.address})` })
    .from(dexTokens)
    .where(and(eq(dexTokens.chainId, chainId), sql`upper(${dexTokens.symbol}) = upper(${wanted})`));
  const contracts = Number(rows[0]?.contracts ?? 0);
  return contracts > 1 ? { symbol: wanted.toUpperCase(), contracts } : null;
}

export async function dexPoolsPage(query: PoolPageQuery, listedIdsFor: (ticker: string) => Promise<string[]>): Promise<PoolPage> {
  const filters = [eq(dexPools.chainId, query.chainId), eq(dexPools.canonical, true)];
  if (query.venue) {
    filters.push(eq(dexPools.venue, query.venue));
  }
  if (query.kind === "listed") {
    filters.push(isNotNull(dexPools.assetId));
  }
  if (query.kind === "community") {
    filters.push(isNull(dexPools.assetId));
  }
  if (query.kind === "lookalike") {
    // The lookalikes table is the store behind the trust badge, so the filter
    // and the badge answer from the same recorded collisions.
    filters.push(isNull(dexPools.assetId));
    filters.push(
      sql`exists (select 1 from lookalike_tokens l where l.chain_id = ${query.chainId} and l.address = ${dexPools.tokenAddress})`,
    );
  }
  // An address or a pool id is someone holding a link, not someone browsing.
  // The tier, the spam floor and the hidden flag are there to shape a default
  // listing; none of them should answer "nothing matches" to a paste of the
  // thing itself.
  const pasted = query.q !== null && searchShapeOf(query.q) !== "text";
  if (query.tier !== "all" && !pasted) {
    filters.push(eq(dexPools.tier, query.tier));
    filters.push(sql`not exists (select 1 from ${dexTokens} t where t.chain_id = ${query.chainId} and t.address = ${dexPools.tokenAddress} and t.hidden)`);
    filters.push(poolStateCurrent, gte(dexPools.depthUsd, String(query.floorUsd)));
  }
  if (query.q) {
    const matched = await searchFilter(query, listedIdsFor);
    if (matched === null) {
      return { pools: [], tokens: new Map(), total: 0 };
    }
    filters.push(matched);
  }
  const where = and(...filters);
  const [rows, totals] = await Promise.all([
    db.select({ ...getTableColumns(dexPools), ...poolSwapColumns, quoteObservation: poolQuoteObservation, stateObservationCurrent: poolStateCurrent.mapWith(Boolean) }).from(dexPools)
      .leftJoin(marketPoolSwapMetrics, poolSwapMembership)
      .leftJoin(marketSwapIndexState, eq(marketSwapIndexState.chainId, dexPools.chainId))
      .where(where).orderBy(poolOrder(query.sort)).limit(query.limit).offset(query.offset),
    db.select({ total: count() }).from(dexPools).where(where),
  ]);
  const addresses = rows.map((row) => row.tokenAddress).filter((address): address is string => address !== null);
  const tokenRows = addresses.length > 0 ? await db.select().from(dexTokens).where(and(eq(dexTokens.chainId, query.chainId), inArray(dexTokens.address, addresses))) : [];
  return { pools: rows, tokens: new Map(tokenRows.map((row) => [row.address, row])), total: totals[0]?.total ?? 0 };
}

const PRICES_NAME = "dex-prices";
const SAMPLE_KEEP_MS = 48 * 60 * 60_000;
// Every priced pool's slot0 in one multicall pass; the state read's decimals
// and quotes do the rest. Drained pools are skipped: a price with no depth
// behind it moves on dust.
export async function samplePoolPrices(chainId: number): Promise<RunOutcome> {
  const pools = await db
    .select()
    .from(dexPools)
    .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true), eq(dexPools.tier, "active"), isNotNull(dexPools.priceUsd), gt(dexPools.depthUsd, sql`0`)));
  if (pools.length === 0) {
    return { rows: 0, detail: { pools: 0 } };
  }
  const assets = await activeAssets(chainId);
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  const usd = await usdPerQuote(assets);
  const tokens = await knownTokens(chainId, pools.flatMap((pool) => pool.tokenAddress ? [pool.tokenAddress] : []));
  const calls = pools.map((pool) => stateCalls(pool)[0]);
  const results = await multicall(l2Client(chainId), calls);
  const at = new Date();
  at.setMilliseconds(0);
  const rows: (typeof dexPriceSamples.$inferInsert)[] = [];
  for (const [index, pool] of pools.entries()) {
    const slot = results[index];
    if (slot.status !== "success" || !Array.isArray(slot.result)) {
      continue;
    }
    const side = pricedSideOf(pool, byId, tokens);
    const quote = pool.quoteAssetId ? (byId.get(pool.quoteAssetId) ?? null) : null;
    if (!side || !quote) {
      continue;
    }
    const [sqrtPriceX96] = slot.result as [bigint, number, number, number];
    const priced = priceOf(pool, sqrtPriceX96, side, quote, usd.get(quote.id) ?? null);
    if (priced.priceUsd === null || !Number.isFinite(priced.priceUsd) || priced.priceUsd <= 0) {
      continue;
    }
    rows.push({ poolId: pool.id, at, priceUsd: priced.priceUsd.toString() });
  }
  for (let start = 0; start < rows.length; start += 1000) {
    await db.insert(dexPriceSamples).values(rows.slice(start, start + 1000)).onConflictDoNothing();
  }
  await db.delete(dexPriceSamples).where(lt(dexPriceSamples.at, new Date(Date.now() - SAMPLE_KEEP_MS)));
  logEvent("registry", { event: "dex-prices-sampled", job: PRICES_NAME, pools: pools.length, sampled: rows.length });
  return { rows: rows.length, detail: { pools: pools.length } };
}

export const CHANGE_WINDOWS = { change5mPct: 5 * 60_000, change1hPct: 60 * 60_000, change6hPct: 6 * 60 * 60_000, change24hPct: 24 * 60 * 60_000 } as const;
export type ChangeKey = keyof typeof CHANGE_WINDOWS;
export type PoolChanges = Record<ChangeKey, number | null>;

// Percent moves against the newest sample taken at or before each window's
// start, from the samples the daemon has: null where no sample is old
// enough, so a pool discovered an hour ago shows 5m and 1h and nothing else,
// and never a made-up zero.
export async function poolChanges(pools: PoolRow[]): Promise<Map<string, PoolChanges>> {
  const out = new Map<string, PoolChanges>();
  const priced = pools.filter((pool) => pool.priceUsd !== null && stateReadIsCurrent(pool.stateCheckedAt));
  if (priced.length === 0) {
    return out;
  }
  const ids = priced.map((pool) => pool.id);
  const now = Date.now();
  const past = new Map<ChangeKey, Map<string, number>>();
  await Promise.all((Object.entries(CHANGE_WINDOWS) as [ChangeKey, number][]).map(async function readWindow([key, windowMs]) {
    const cutoff = new Date(now - windowMs);
    // The newest sample at or before the cutoff, per pool, but not one so old
    // that it belongs to the previous window (a 5m figure must not read a
    // day-old sample).
    const floor = new Date(now - windowMs * 2 - 15 * 60_000);
    const rows = await db.execute<{ pool_id: string; price_usd: string }>(sql`
      SELECT DISTINCT ON (pool_id) pool_id, price_usd
      FROM dex_price_samples
      WHERE pool_id IN ${ids} AND at <= ${cutoff} AND at >= ${floor}
      ORDER BY pool_id, at DESC
    `);
    past.set(key, new Map(rows.rows.map((row) => [row.pool_id, Number(row.price_usd)])));
  }));
  for (const pool of priced) {
    const current = Number(pool.priceUsd);
    const changes = {} as PoolChanges;
    for (const key of Object.keys(CHANGE_WINDOWS) as ChangeKey[]) {
      const then = past.get(key)?.get(pool.id);
      changes[key] = then && then > 0 && Number.isFinite(current) ? Number((((current - then) / then) * 100).toFixed(2)) : null;
    }
    out.set(pool.id, changes);
  }
  return out;
}

export interface PoolKindCounts {
  listed: number;
  community: number;
  lookalike: number;
  priced: number;
  tokensRead: number;
  tiers: Record<PoolTier, number>;
}

// How many pools of each kind are on record, for a card that points at the
// market table.
export async function poolKindCounts(chainId: number): Promise<PoolKindCounts> {
  const [rows, tokens, tierRows, lookalikeRows] = await Promise.all([
    db
      .select({
        listed: count(dexPools.assetId),
        total: count(),
        priced: count(dexPools.priceUsd),
      })
      .from(dexPools)
      .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true))),
    db.select({ read: count() }).from(dexTokens).where(and(eq(dexTokens.chainId, chainId), isNotNull(dexTokens.decimals))),
    db.select({ tier: dexPools.tier, pools: count() }).from(dexPools).where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true))).groupBy(dexPools.tier),
    db
      .select({ pools: count() })
      .from(dexPools)
      .where(
        and(
          eq(dexPools.chainId, chainId), eq(dexPools.canonical, true),
          isNull(dexPools.assetId),
          sql`exists (select 1 from lookalike_tokens l where l.chain_id = ${chainId} and l.address = ${dexPools.tokenAddress})`,
        ),
      ),
  ]);
  const row = rows[0];
  const tiers = Object.fromEntries(POOL_TIERS.map((tier) => [tier, 0])) as Record<PoolTier, number>;
  for (const entry of tierRows) {
    if ((POOL_TIERS as string[]).includes(entry.tier)) {
      tiers[entry.tier as PoolTier] = entry.pools;
    }
  }
  return {
    listed: row?.listed ?? 0,
    community: (row?.total ?? 0) - (row?.listed ?? 0),
    lookalike: lookalikeRows[0]?.pools ?? 0,
    priced: row?.priced ?? 0,
    tokensRead: tokens[0]?.read ?? 0,
    tiers,
  };
}

const TIERS_NAME = "dex-tiers";

// Once a day, every pool's tier is recomputed from what the reads and the
// swap scan recorded. Promotions also happen inline (a swap, or depth found
// by the state read); this pass is where demotions happen.
export async function retierPools(chainId: number): Promise<RunOutcome> {
  const pools = await db
    .select({ id: dexPools.id, tier: dexPools.tier, depthUsd: dexPools.depthUsd, liquidity: dexPools.liquidity, lastSwapAt: dexPools.lastSwapAt, firstSeenAt: dexPools.firstSeenAt, stateCheckedAt: dexPools.stateCheckedAt })
    .from(dexPools)
    .where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true)));
  const now = new Date();
  const moves = new Map<PoolTier, string[]>();
  for (const pool of pools) {
    const next = tierOf({
      depthUsd: pool.depthUsd === null ? null : Number(pool.depthUsd),
      liquidity: pool.liquidity === null ? null : BigInt(pool.liquidity.split(".")[0]),
      lastSwapAt: pool.lastSwapAt,
      firstSeenAt: pool.firstSeenAt,
      stateCheckedAt: pool.stateCheckedAt,
      now,
    });
    if (next !== pool.tier) {
      const ids = moves.get(next) ?? [];
      ids.push(pool.id);
      moves.set(next, ids);
    }
  }
  let changed = 0;
  for (const [tier, ids] of moves) {
    for (let start = 0; start < ids.length; start += 500) {
      await db.update(dexPools).set({ tier }).where(inArray(dexPools.id, ids.slice(start, start + 500)));
    }
    changed += ids.length;
  }
  const detail = Object.fromEntries(POOL_TIERS.map((tier) => [tier, moves.get(tier)?.length ?? 0]));
  logEvent("registry", { event: "dex-retiered", job: TIERS_NAME, pools: pools.length, changed, ...detail });
  return { rows: changed, detail: { pools: pools.length, ...detail } };
}
