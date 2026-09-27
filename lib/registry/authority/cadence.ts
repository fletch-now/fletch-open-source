// One table of every registry job and how often it runs, shared by the daemon
// that schedules them (workers/registry.ts) and the freshness read that judges
// them (freshness.ts), so "late" is measured against the number the scheduler
// actually uses. No imports: the worker loads this before its environment.

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

// Cadences follow the source: logs every ten seconds, contract reads every
// few minutes, the issuer's API on its own cache times, snapshots daily or
// hourly depending on whether a missed run can be made up later. The
// startup scheduler favors shorter cadences and uses this order to break ties.
export const JOB_CADENCES = {
  "app-catalog": 15 * SECOND,
  "explorer-scouting": MINUTE,
  "stock-pair-history": MINUTE,
  // 20 s, not 10: on the public RPC the control plane's two calls per run
  // were a third of the whole quota, and history scans got none.
  "control-plane": 20 * SECOND,
  "authority-match": 10 * SECOND,
  // Reads the pool table, not the chain, so it costs no RPC budget; a minute
  // keeps a launch alert close to the discovery that found it.
  "new-pool-match": MINUTE,
  "chain-health": 60 * SECOND,
  feeds: MINUTE,
  "supply-events": 2 * MINUTE,
  "multiplier-events": 5 * MINUTE,
  "token-state": 5 * MINUTE,
  "api-prices": 5 * MINUTE,
  "corporate-actions": HOUR,
  canonical: 6 * HOUR,
  bridged: 6 * HOUR,
  "transfer-ledger": MINUTE,
  // Hourly rather than daily: a fresh database has tens of thousands of
  // holders to probe and one run's RPC budget covers a fraction of them, so
  // the labels fill in over a few hours instead of a few days.
  "holder-labels": HOUR,
  concentration: 24 * HOUR,
  "dex-pools": MINUTE,
  "dex-pools-v3": MINUTE,
  "dex-state": 45 * SECOND,
  "priority-universe": MINUTE,
  "priority-holders": MINUTE,
  // Small resumable metadata batches share the existing RPC lane and daily cap.
  "dex-tokens": MINUTE,
  "dex-token-discovery": MINUTE,
  "priority-supply": MINUTE,
  "dex-prices": MINUTE,
  // Hourly, not daily: the day discovery found twenty thousand new pools,
  // every one was active until read, and a daily demotion left the state
  // read spending the whole budget on empty pools for a day.
  "dex-tiers": HOUR,
  "dex-swaps": 45 * SECOND,
  "dex-swap-backfill": MINUTE,
  "market-refresh": 15 * SECOND,
  "bridge-flows": 2 * MINUTE,
  "bridge-escrow": 30 * MINUTE,
  "issuer-docs": 6 * HOUR,
  "issuer-pages": HOUR,
  "feed-history": 30 * MINUTE,
  "second-source": HOUR,
  // Durable pages rotate through the catalog without monopolizing the worker.
  lookalikes: MINUTE,
  "supply-snapshot": 24 * HOUR,
  // Hourly, not daily: the row is keyed on the UTC day and upserted, so an
  // hourly run refreshes the current day and no day can be skipped. A 24 h
  // timer rescheduled after each run drifts forward and eventually steps over
  // a midnight, leaving a day with no row at all and nothing to revisit it.
  "state-daily": HOUR,
} as const satisfies Record<string, number>;

export type JobName = keyof typeof JOB_CADENCES;

export const JOB_NAMES = Object.keys(JOB_CADENCES) as JobName[];

// The row in daemon_heartbeats the registry daemon upserts every 15 seconds.
export const REGISTRY_HEARTBEAT = "registry-daemon";
export const REGISTRY_HEARTBEAT_MS = 15 * SECOND;

// The sync_checkpoints rows each log scanner advances, without the `:chainId`
// suffix. A scanner with no row here reads at head every run.
export const JOB_CHECKPOINTS: Partial<Record<JobName, readonly string[]>> = {
  "stock-pair-history": ["stock-pairs-v4", "stock-pairs-v3"],
  "control-plane": ["control-plane"],
  "supply-events": ["supply-mint", "supply-burn"],
  "multiplier-events": ["multiplier-events"],
  "transfer-ledger": ["transfer-ledger"],
  "dex-pools": ["dex-pools"],
  "dex-pools-v3": ["dex-pools-v3"],
  "dex-swaps": ["market-swaps-live"],
  "bridge-flows": ["bridge-flows"],
};

// A checkpoint this far behind head is a first pass over history still in
// progress, which is work, not lateness. The same bound keeps the daily
// concentration reading from describing a half-read ledger.
export const FILLING_BEHIND_BLOCKS = BigInt(10_000);

// Asked by the freshness verdict, the freshness page and the daily snapshot,
// which must all agree on when a scanner's answer is a first pass rather than
// the chain's current state.
export function stillFilling(behind: bigint | null): boolean {
  return behind !== null && behind > FILLING_BEHIND_BLOCKS;
}
