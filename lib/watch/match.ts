// The per-watcher match decision (docs/MVP.md, ticket 6 follow-up: wallet
// activity). Pure and side-effect-free on purpose — poll.ts does the I/O
// (fetching logs, writing the outbox), this just decides whether one already
// -fetched log is a hit for one watcher, so it can be unit-tested without a
// database or an RPC client.
//
// No "server-only", no next/*, no React, no lib/dal — poll.ts (imported by
// workers/watch.ts, a plain `tsx` process) imports this module directly.

import type { WatcherKind } from "@/lib/watch/types";

export interface MatchWatcher {
  kind: WatcherKind;
  // wallet_activity only; ignored for large_transfer. Compared
  // case-insensitively — callers don't need to pre-lowercase it.
  wallet: string | null;
  thresholdRaw: bigint;
}

export interface MatchLog {
  from: string;
  to: string;
  value: bigint;
}

export interface MatchResult {
  matched: boolean;
  // Set only when matched and kind is wallet_activity.
  direction?: "in" | "out";
}

const NO_MATCH: MatchResult = { matched: false };

// A decimal threshold string ("1000" or "1000.5") turned into the raw uint256
// scale the log's `value` is compared against, via BigInt math only — never a
// float round-trip. Extra fractional digits beyond the token's own decimals are
// truncated, not rounded: the token can't represent them, and truncating a
// threshold down is the direction that can't hide a transfer that should alert.
// The decimals come from the registry for a listed asset and from the
// contract's own decimals() for a pasted address, so a six-decimal token is
// compared on its own scale rather than on an assumed eighteen.
export function thresholdToRaw(threshold: string, decimals: number): bigint {
  const [wholePart, fractionPart = ""] = threshold.split(".");
  const fraction = fractionPart.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(wholePart) * BigInt(10) ** BigInt(decimals) + BigInt(fraction || "0");
}

// large_transfer: any Transfer at or above the threshold, sender/receiver
// unconstrained. wallet_activity: the watched wallet must be on one side of
// the transfer *and* the amount must clear the threshold (0 clears every
// transfer, including a zero-value one) — direction is "out" when the wallet
// sent it, "in" otherwise.
export function matchesWatcher(watcher: MatchWatcher, log: MatchLog): MatchResult {
  if (watcher.kind === "large_transfer") {
    return log.value >= watcher.thresholdRaw ? { matched: true } : NO_MATCH;
  }

  if (!watcher.wallet) {
    return NO_MATCH;
  }
  const wallet = watcher.wallet.toLowerCase();
  const from = log.from.toLowerCase();
  const to = log.to.toLowerCase();
  const touchesWallet = from === wallet || to === wallet;
  if (!touchesWallet || log.value < watcher.thresholdRaw) {
    return NO_MATCH;
  }
  return { matched: true, direction: from === wallet ? "out" : "in" };
}
