// The quote side of a pool in dollars, and never the token side: a token's
// decimals and supply are whatever its own contract says, so any figure priced
// through them can be made up by whoever deployed it. USDG and WETH cannot.
//
// Pure on purpose — dex.ts does the reads, this does the arithmetic, and the
// arithmetic is what put thirteen billion dollars of depth on a launchpad
// clone, so it is unit-tested on its own.

import { formatUnits } from "viem";

const Q96 = BigInt(2) ** BigInt(96);
// sqrt(1.01) - 1: the fraction of sqrtP a 1% price move crosses.
const ONE_PCT_SQRT_STEP = Math.sqrt(1.01) - 1;

export interface QuoteSide {
  address: string;
  decimals: number;
}

// A token balance in dollars.
export function usdOf(raw: bigint, quote: QuoteSide, usdPerQuote: number): number {
  return Number(formatUnits(raw, quote.decimals)) * usdPerQuote;
}

// The quote a 1% move would cross: L times the change in sqrtP. Uniswap's L is
// in units of sqrt(token0_raw * token1_raw). This is a bounded estimate of
// quote input for a 1% move, distinct from V3 quote holdings. A move that leaves the
// position's range runs out of liquidity first — and for a pool whose
// liquidity sits in an extreme price range the bound is absurd.
export function onePctDepthUsd(currency1: string, quote: QuoteSide, sqrtPriceX96: bigint, liquidity: bigint, usdPerQuote: number): number | null {
  if (sqrtPriceX96 <= BigInt(0) || liquidity <= BigInt(0)) {
    return null;
  }
  const quoteIsOne = currency1.toLowerCase() === quote.address.toLowerCase();
  const virtualQuote = quoteIsOne ? (liquidity * sqrtPriceX96) / Q96 : (liquidity * Q96) / sqrtPriceX96;
  const crossed = usdOf(virtualQuote, quote, usdPerQuote) * ONE_PCT_SQRT_STEP;
  return Number.isFinite(crossed) && crossed > 0 ? crossed : null;
}

// A v4 pool's funds sit in the shared PoolManager, so its own reserve cannot be
// read. The estimate above stands in for it, and only while it is no larger
// than what that venue actually holds of the token: above that it is known to
// be wrong, and a figure known to be wrong is not published.
export function withinVenueHoldings(estimateUsd: number | null, venueHoldsUsd: number | null): number | null {
  if (estimateUsd === null || venueHoldsUsd === null || !Number.isFinite(estimateUsd) || !Number.isFinite(venueHoldsUsd) || estimateUsd < 0 || venueHoldsUsd < 0) {
    return null;
  }
  if (estimateUsd > venueHoldsUsd) {
    return null;
  }
  return estimateUsd;
}

export interface SupplyRead {
  totalSupplyRaw: string | null;
  burnedRaw: string | null;
  decimals: number | null;
}

// Total supply minus what sits at the burn addresses, priced from the pool.
// Circulating supply is not knowable on chain — a treasury wallet and a holder
// look the same — so this is the honest ceiling on it, and it is null unless
// supply, burn and decimals were all read.
export function marketCapUsd(token: SupplyRead, priceUsd: number | null): number | null {
  if (priceUsd === null || !Number.isFinite(priceUsd) || priceUsd < 0 || token.totalSupplyRaw === null || token.burnedRaw === null || token.decimals === null
    || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 255
    || !/^\d+$/.test(token.totalSupplyRaw) || !/^\d+$/.test(token.burnedRaw)) {
    return null;
  }
  const outstanding = BigInt(token.totalSupplyRaw) - BigInt(token.burnedRaw);
  if (outstanding < BigInt(0)) {
    return null;
  }
  const value = Number(formatUnits(outstanding, token.decimals)) * priceUsd;
  return Number.isFinite(value) ? value : null;
}
