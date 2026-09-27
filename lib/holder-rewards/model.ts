import { z } from "zod";

export const HOLDER_POLICY_KEY = "credits.fltx.policy";
export const HOLDER_CAMPAIGN = "fltx-holders-v1";
export const HOLDER_CREDITS = 10;
export const HOLDER_THRESHOLD_USD = "100";
export const HOLDER_CHECK_MS = 60_000;
export const HOLDER_PRICE_MAX_AGE_MS = 120_000;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase());
export const HolderPolicySchema = z.object({
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  chainId: z.literal(4663).nullable(),
  tokenAddress: address.nullable(),
  referencePoolId: z.string().min(1).max(100).nullable(),
  period: z.enum(["once", "utc_month", "utc_day"]).nullable(),
  immediateGrantAccepted: z.boolean(),
  minDepthUsd: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).refine(value => Number(value) >= 25_000),
  maxGrantsPerDay: z.number().int().min(1).max(1000),
  activatedAt: z.string().datetime().nullable(),
}).strict();
export type HolderPolicy = z.infer<typeof HolderPolicySchema>;
export const EMPTY_HOLDER_POLICY: HolderPolicy = {
  revision: 0, enabled: false, chainId: null, tokenAddress: null,
  referencePoolId: null, period: null, immediateGrantAccepted: false,
  minDepthUsd: "25000", maxGrantsPerDay: 100, activatedAt: null,
};

export function activationProblem(policy: HolderPolicy): string | null {
  if (!policy.chainId || !policy.tokenAddress || /^0x0{40}$/.test(policy.tokenAddress)) return "Set the official token contract and supported network.";
  if (!policy.referencePoolId) return "Select and verify the token's reference market.";
  if (!policy.period) return "Choose whether the 10-credit reward is once, monthly or daily.";
  if (!policy.immediateGrantAccepted) return "Confirm immediate grants or implement the agreed holding-period rule before activation.";
  return null;
}

export function rewardPeriod(policy: HolderPolicy, now: Date): string {
  if (policy.period === "once") return "once";
  if (policy.period === "utc_month") return now.toISOString().slice(0, 7);
  if (policy.period === "utc_day") return now.toISOString().slice(0, 10);
  throw new Error("Holder reward period is not configured.");
}

// Exact decimal arithmetic: displayed cents never decide who clears $100.
export function decimalFraction(value: string): { units: bigint; scale: bigint } {
  if (!/^\d{1,78}(\.\d{1,36})?$/.test(value)) throw new Error("Invalid unsigned decimal.");
  const [whole, fraction = ""] = value.split(".");
  return { units: BigInt(whole + fraction), scale: BigInt(10) ** BigInt(fraction.length) };
}

export function holdingValue(raw: string, decimals: number, priceUsd: string): { qualifies: boolean; valueUsd: string } {
  if (!/^\d{1,78}$/.test(raw) || BigInt(raw) > BigInt(2) ** BigInt(256) - BigInt(1) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new Error("Invalid token balance or decimals.");
  const price = decimalFraction(priceUsd);
  if (price.units === BigInt(0)) throw new Error("A positive token price is required.");
  const numerator = BigInt(raw) * price.units;
  const denominator = BigInt(10) ** BigInt(decimals) * price.scale;
  const cents = numerator * BigInt(100) / denominator;
  return { qualifies: numerator > BigInt(100) * denominator, valueUsd: `${cents / BigInt(100)}.${String(cents % BigInt(100)).padStart(2, "0")}` };
}

export interface HolderEvidence {
  address: string;
  chainId: number;
  tokenAddress: string;
  balanceRaw: string;
  decimals: number;
  priceUsd: string;
  poolId: string;
  depthUsd: string;
  priceAt: string;
  checkedAt: string;
  safeBlock: string;
  safeBlockHash: string;
  latestBlock: string;
}

export type HolderState = "not_open" | "checking" | "verify_wallet" | "below_threshold" | "unavailable" | "granted" | "already_granted" | "daily_limit";
export interface HolderStatus {
  state: HolderState;
  message: string;
  credits: 10;
  thresholdUsd: "100";
  period: HolderPolicy["period"];
  checkedAt: string | null;
  priceAt: string | null;
  valueUsd: string | null;
  wallet: string | null;
  tokenAddress: string | null;
  chainId: number | null;
  grantId: string | null;
  balance?: number;
}

export function holderStatus(policy: HolderPolicy, state: HolderState, message: string, details: Partial<HolderStatus> = {}): HolderStatus {
  return { state, message, credits: HOLDER_CREDITS, thresholdUsd: HOLDER_THRESHOLD_USD, period: policy.period,
    checkedAt: null, priceAt: null, valueUsd: null, wallet: null,
    tokenAddress: policy.tokenAddress, chainId: policy.chainId, grantId: null, ...details };
}
