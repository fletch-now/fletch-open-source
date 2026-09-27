// Shared contracts for Fletch Watch (docs/MVP.md). Everything the daemon, the API
// routes and the dashboard agree on lives here, so each can be built alone.

export type WatcherKind = "large_transfer" | "wallet_activity" | "registry_event" | "listing_event" | "token_event" | "new_pool";

// What Fletch could say about the token at the moment the alert was raised.
// Optional on the payload: rows written before trust stamps existed have none,
// and the formatter leaves their messages exactly as they were.
export interface TrustStamp {
  level: "verified" | "listed" | "lookalike" | "community" | "unknown";
  // Set only for a lookalike: the listed token this one imitates.
  impersonates: { symbol: string; address: string } | null;
}

// The two kinds the transfer poller owns; the other two are fed by the
// authority matcher from authority_events.
export const TRANSFER_KINDS: readonly WatcherKind[] = ["large_transfer", "wallet_activity"];
export const AUTHORITY_KINDS: readonly WatcherKind[] = ["registry_event", "listing_event", "token_event"];

export function isAuthorityWatcherKind(kind: WatcherKind): boolean {
  return AUTHORITY_KINDS.includes(kind);
}

// Neither the transfer poller's nor the authority matcher's: the whole chain
// is its target, and the registry daemon fans new pools out to it.
export const CHAIN_KINDS: readonly WatcherKind[] = ["new_pool"];

export function isWatcherKind(value: string): value is WatcherKind {
  return (TRANSFER_KINDS as readonly string[]).includes(value) || (AUTHORITY_KINDS as readonly string[]).includes(value) || (CHAIN_KINDS as readonly string[]).includes(value);
}
export type WatcherStatus = "active" | "catching_up" | "degraded" | "paused";
// Where a watcher's alerts are sent. Telegram is the original and the default;
// "webhook" posts a signed JSON body to an endpoint the account registered.
export type DeliveryChannel = "telegram" | "webhook";
// held: detected and kept, with nowhere to send yet (Telegram not linked).
export type DeliveryStatus = "pending" | "sent" | "failed" | "retracted" | "held";

// What a matched event carries into the outbox and on to Telegram. Amounts travel
// as strings: `value` is the raw uint256, `amount` the human number.
export interface LargeTransferPayload {
  kind: "large_transfer";
  chainId: number;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  from: string;
  to: string;
  value: string;
  amount: string;
  threshold: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  blockHash: string;
  explorerUrl: string;
  trust?: TrustStamp;
}

// A transfer that touched a watched wallet, on either side. `direction` says which.
export interface WalletActivityPayload extends Omit<LargeTransferPayload, "kind"> {
  kind: "wallet_activity";
  wallet: string;
  direction: "in" | "out";
}

// One authority event (lib/registry/authority/events.ts) delivered to a
// registry_event or token_event watcher. `eventKind` is the dotted event kind.
export interface AuthorityPayload {
  kind: "authority";
  chainId: number;
  eventId: string;
  eventKind: string;
  title: string;
  symbol: string | null;
  address: string | null;
  detail: Record<string, unknown> | null;
  txHash: string | null;
  blockNumber: string | null;
  occurredAt: string;
  explorerUrl: string | null;
  registryUrl: string;
}

// A pool that appeared on a DEX, delivered to a new_pool watcher. Every figure
// is what the registry had read when the alert was raised; a pool nobody has
// priced yet carries nulls, and the message says so rather than showing a zero.
export interface NewPoolPayload {
  kind: "new_pool";
  chainId: number;
  poolId: string;
  venue: string;
  tokenAddress: string | null;
  symbol: string | null;
  name: string | null;
  quote: string | null;
  priceUsd: string | null;
  depthUsd: string | null;
  createdBlock: string | null;
  firstSeenAt: string;
  trust?: TrustStamp;
  tokenUrl: string;
  explorerUrl: string | null;
}

export type DeliveryPayload = LargeTransferPayload | WalletActivityPayload | AuthorityPayload | NewPoolPayload;

// Ceilings. Cheap to raise, expensive to discover the hard way.
export const WATCH_LIMITS = {
  watchersPerUser: 5,
  // A chain-wide watcher hears about every launch, so one per account is the
  // ceiling; a second would only double the same messages.
  newPoolWatchersPerUser: 1,
  // New pools per matcher run per watcher. A launchpad can make hundreds in an
  // hour; the rest are picked up by the next run rather than sent at once.
  newPoolsPerRun: 20,
  watchersPlatform: 500,
  rpcCallsPerDay: 400_000,
  pollIntervalMs: 6_000,
  deliverIntervalMs: 1_500,
  logChunkBlocks: 2_000,
  maxDeliveryAttempts: 8,
  webhookEndpointsPerUser: 5,
  webhookTimeoutMs: 10_000,
  // Lag beyond this many blocks is "catching up" rather than "active".
  catchingUpBlocks: 600,
} as const;

export const HEARTBEAT_NAME = "watch-daemon";
