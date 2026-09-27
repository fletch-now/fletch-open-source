import { RH_MAINNET_ID, RH_TESTNET_ID, STARTER_CREDITS } from "@/lib/config";
import { WATCH_LIMITS } from "@/lib/watch/types";

// Current offer values come from the same constants used by admission and grants.
// Proposed subscription allowances are separate from the current beta offer.
export const PRODUCT_TERMS = {
  starterCredits: STARTER_CREDITS,
  watchersPerAccount: WATCH_LIMITS.watchersPerUser,
  buildChainId: RH_TESTNET_ID,
  watchChainId: RH_MAINNET_ID,
  plannedBuilder: { monthlyUsd: 19, monthlyCredits: 100, watchers: 25 },
} as const;

export const STARTER_CREDIT_DESCRIPTION = `${PRODUCT_TERMS.starterCredits} free build credit for each new address after wallet sign-in`;
export const BUILD_WATCH_NETWORK_DESCRIPTION = `Build deploys contracts to Robinhood Chain testnet (${PRODUCT_TERMS.buildChainId}). Registry and Watch cover mainnet (${PRODUCT_TERMS.watchChainId}).`;
export const CHECKOUT_DESCRIPTION = `Paid checkout is not open. The Builder subscription is planned at $${PRODUCT_TERMS.plannedBuilder.monthlyUsd}/month.`;
