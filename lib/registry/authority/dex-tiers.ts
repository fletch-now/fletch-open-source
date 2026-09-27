// Which pools the daemon spends its RPC budget on. Most pools on the chain are
// launchpad leftovers with nothing in them, and reading their state every ten
// minutes would cost the budget the live ones need. Nothing is deleted: a
// dormant pool stays on record with its history, is read once a week, and
// comes back the moment it trades or refills. Pure, so the rule is tested.

export type PoolTier = "active" | "quiet" | "dormant";

export const POOL_TIERS: PoolTier[] = ["active", "quiet", "dormant"];

// Dollars of depth that make a pool worth reading every ten minutes.
export const ACTIVE_DEPTH_USD = 100;
// A pool that traded this recently is active whatever its depth.
export const ACTIVE_SWAP_MS = 7 * 24 * 60 * 60_000;
// Without a swap for this long and with no depth to speak of, a pool is dormant.
export const DORMANT_SWAP_MS = 30 * 24 * 60 * 60_000;
export const DORMANT_DEPTH_USD = 10;

export interface TierInput {
  depthUsd: number | null;
  liquidity: bigint | null;
  lastSwapAt: Date | null;
  firstSeenAt: Date;
  // When the state read last looked at the pool; null until it has.
  stateCheckedAt: Date | null;
  now: Date;
}

function swappedWithin(input: TierInput, windowMs: number): boolean {
  return input.lastSwapAt !== null && input.now.getTime() - input.lastSwapAt.getTime() <= windowMs;
}

// A pool the state read has not looked at yet cannot be judged: it stays
// active until it is read once. A pool found today that has been read and
// found empty is judged like any other; a launch that trades is promoted by
// the swap scan the moment it does.
function unread(input: TierInput): boolean {
  return input.stateCheckedAt === null;
}

export function tierOf(input: TierInput): PoolTier {
  const depth = input.depthUsd ?? 0;
  if (unread(input) || depth >= ACTIVE_DEPTH_USD || swappedWithin(input, ACTIVE_SWAP_MS)) {
    return "active";
  }
  const drained = input.liquidity !== null && input.liquidity === BigInt(0);
  if ((drained || depth < DORMANT_DEPTH_USD) && !swappedWithin(input, DORMANT_SWAP_MS)) {
    return "dormant";
  }
  return "quiet";
}
