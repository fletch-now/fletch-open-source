import { formatUnits, type Address, type PublicClient } from "viem";
import { AGGREGATOR_ABI } from "./abis";
import { CHAINLINK_FEED_DIRECTORY } from "./constants";
import { feedDirectory } from "./feeds";
import type { TimedBlock } from "./market-swap-window";

// Published Robinhood mainnet contracts, also seeded in registry/sync.ts.
// Identity is the address, never a token's self-reported symbol.
export const SWAP_USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const SWAP_WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";
export const MAX_QUOTE_SAMPLE_SECONDS = 3_600;
export const MAX_ORACLE_AGE_SECONDS = 3_600;

export interface SwapQuote {
  address: string;
  decimals: number;
  method: "usdg_nominal" | "historical_chainlink_window_start";
  source: string;
  priceRaw: bigint;
  priceDecimals: number;
  sampledBlock: string | null;
  sampledAt: string | null;
  oracleUpdatedAt: string | null;
  maxOracleAgeSeconds: number | null;
  heartbeatSource: string | null;
}

export function swapQuoteAddress(chainId: number, currency0: string, currency1: string): string | null {
  if (chainId !== 4663) return null;
  const currencies = [currency0.toLowerCase(), currency1.toLowerCase()];
  if (currencies.includes(SWAP_USDG)) return SWAP_USDG;
  return currencies.includes(SWAP_WETH) ? SWAP_WETH : null;
}

export function nominalUsdgQuote(): SwapQuote {
  return { address: SWAP_USDG, decimals: 6, method: "usdg_nominal", source: "USDG denomination: 1 USDG = 1 USD; not a market-price observation",
    priceRaw: BigInt(1), priceDecimals: 0, sampledBlock: null, sampledAt: null, oracleUpdatedAt: null, maxOracleAgeSeconds: null, heartbeatSource: null };
}

export function historicalQuote(start: TimedBlock, end: TimedBlock, feedAddress: string, decimals: number,
  round: readonly [bigint, bigint, bigint, bigint, bigint], heartbeatSeconds?: number | null): SwapQuote | null {
  const publishedHeartbeat = Number.isSafeInteger(heartbeatSeconds) && Number(heartbeatSeconds) > 0 && Number(heartbeatSeconds) <= 86_400;
  const maxOracleAge = publishedHeartbeat ? Number(heartbeatSeconds) : MAX_ORACLE_AGE_SECONDS;
  const [roundId, answer, , updatedAt, answeredInRound] = round;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || answer <= BigInt(0) || updatedAt <= BigInt(0) ||
    answeredInRound < roundId || updatedAt > start.timestamp || end.timestamp < start.timestamp ||
    end.timestamp - start.timestamp > BigInt(MAX_QUOTE_SAMPLE_SECONDS) ||
    end.timestamp - updatedAt > BigInt(maxOracleAge)) return null;
  return { address: SWAP_WETH, decimals: 18, method: "historical_chainlink_window_start", source: `Historical window-start Chainlink ETH/USD estimate at ${feedAddress.toLowerCase()}`,
    priceRaw: answer, priceDecimals: decimals, sampledBlock: start.number.toString(),
    sampledAt: new Date(Number(start.timestamp) * 1000).toISOString(), oracleUpdatedAt: new Date(Number(updatedAt) * 1000).toISOString(), maxOracleAgeSeconds: maxOracleAge,
    heartbeatSource: publishedHeartbeat ? CHAINLINK_FEED_DIRECTORY : null };
}

export async function readHistoricalWethQuote(client: PublicClient, start: TimedBlock, end: TimedBlock): Promise<SwapQuote | null> {
  const feed = (await feedDirectory()).find((entry) => entry.symbol === "WETH");
  if (!feed) return null;
  const round = await client.readContract({ address: feed.address as Address, abi: AGGREGATOR_ABI,
    functionName: "latestRoundData", blockNumber: start.number });
  const atStart = historicalQuote(start, start, feed.address, feed.decimals, round, feed.heartbeatSeconds);
  if (atStart && !historicalQuote(start, end, feed.address, feed.decimals, round, feed.heartbeatSeconds)) throw new Error("Swap historical quote window is too wide");
  return historicalQuote(start, end, feed.address, feed.decimals, round, feed.heartbeatSeconds);
}

// One leg only, with integer arithmetic until the final decimal string. A
// historical quote is an explicitly timed estimate, not the swap's fill price.
export function valueSwap(currency0: string, currency1: string, amount0: bigint, amount1: bigint, quote: SwapQuote): string {
  const side = currency0.toLowerCase() === quote.address ? amount0 : currency1.toLowerCase() === quote.address ? amount1 : null;
  if (side === null) throw new Error("Swap quote is not a pool currency");
  return formatUnits((side < BigInt(0) ? -side : side) * quote.priceRaw, quote.decimals + quote.priceDecimals);
}

export function quoteEvidence(quote: SwapQuote): Record<string, unknown> {
  return { method: quote.method, quoteAddress: quote.address, quoteDecimals: quote.decimals, source: quote.source,
    price: formatUnits(quote.priceRaw, quote.priceDecimals), sampledBlock: quote.sampledBlock, sampledAt: quote.sampledAt,
    oracleUpdatedAt: quote.oracleUpdatedAt, estimated: quote.method !== "usdg_nominal",
    maxSampleAgeSeconds: quote.method === "usdg_nominal" ? null : MAX_QUOTE_SAMPLE_SECONDS,
    maxOracleAgeSeconds: quote.maxOracleAgeSeconds, heartbeatSource: quote.heartbeatSource };
}
