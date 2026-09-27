import type { ScoutingCoverage } from "../scouting";
import { readCoverageReceipt, coverageReceiptStatus } from "../coverage-receipt";
import { publicDiagnostic } from "@/lib/public-copy";
// Whether the registry is live, in one read: the daemon's pulse, every job
// against the cadence it is scheduled on, the scanners still reading history,
// and the newest timestamp behind each public number. Read from the same
// sync_runs, sync_checkpoints and daemon_heartbeats rows fletch-ops prints,
// so "live" on a page is the claim the ops report makes, not a word.

import { and, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
  assetConcentration,
  assetStateDaily,
  authorityEvents,
  bridgeEscrow,
  bridgeFlows,
  chainHealth,
  dexPools,
  feedRounds,
  holderBalances,
  holderLabels,
  issuerDocuments,
  issuerPages,
  lookalikeTokens,
  registryAssetState,
  registryControlState,
  registryCorporateActions,
  registryMultiplierEvents,
  registrySupplyEvents,
  registrySupplySnapshots,
  syncCheckpoints,
} from "@/lib/db/schema";
import { metadataBacklogFromDetail, type TokenMetadataBacklog } from "./dex-token-schedule";
import { readSwapIndexer, type SwapIndexerReading } from "./market-swap-status";
import { readHeartbeatNamed } from "@/lib/watch/heartbeat";
import { JOB_CADENCES, JOB_CHECKPOINTS, JOB_NAMES, REGISTRY_HEARTBEAT, stillFilling, type JobName } from "@/lib/registry/authority/cadence";
import { metricCoverageFromDetail, type MetricCoverageMap } from "./metric-coverage";
import { checkpointSamples } from "@/lib/registry/authority/runs";
import { readJobRunSnapshots } from "./job-run-snapshots";
import { readCurrentSwapFigure } from "./status-counts";
import { getLookalikeCoverage, type LookalikeCoverage } from "./lookalikes";

export type JobVerdict = "fresh" | "late" | "failing" | "filling" | "stalled" | "never";
export type FigureVerdict = JobVerdict | "unread";
export type OverallVerdict = "live" | "degraded" | "stale" | "never";

// Four missed heartbeats. The daemon beats every 15 seconds; a minute without
// one is a stopped process, not a slow loop.
export const DAEMON_STALE_MS = 60_000;
export const DEGRADED_JOB_THRESHOLD = 10;

const HOUR_MS = 3_600_000;

export const VERDICT_MEANING: Record<JobVerdict | OverallVerdict | "unread", string> = {
  fresh: "the last run succeeded within twice the job's cadence",
  late: "the last successful run is older than twice the cadence",
  failing: "the last run ended in an error; the previous answer stands",
  filling: "a history scan or measured coverage remains incomplete",
  stalled: "A scanner still reading history whose checkpoint has not moved in far longer than its cadence: the backfill is stuck, not slow.",
  never: "the job has not completed a run against this database",
  unread: "no row carries this figure yet",
  live: "the worker is running and fewer than 10 jobs are failing, late, stalled or awaiting their first completed run",
  degraded: "the worker is running and at least 10 jobs are failing, late, stalled or awaiting their first completed run",
  stale: "the daemon has not beaten for a minute; every figure is as old as its last run",
};

export interface CheckpointProgress {
  name: string;
  block: bigint;
  head: bigint | null;
  behind: bigint | null;
  updatedAt: Date;
  blocksPerHour: number | null;
  hoursLeft: number | null;
}

export interface JobFreshness {
  job: JobName;
  cadenceMs: number;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  ageMs: number | null;
  rows: number | null;
  error: string | null;
  running: boolean;
  verdict: JobVerdict;
  checkpoints: CheckpointProgress[];
  metadataBacklog?: TokenMetadataBacklog | null;
  metricCoverage?: MetricCoverageMap | null;
}

export interface FigureFreshness {
  figure: string;
  what: string;
  job: JobName;
  cadenceMs: number;
  newestAt: Date | null;
  ageMs: number | null;
  count: number;
  unit: string;
  verdict: FigureVerdict;
}

export interface DaemonFreshness {
  name: string;
  lastBeatAt: Date | null;
  ageMs: number | null;
  alive: boolean;
  jobsReported: number | null;
  failing: string[];
}

export interface HeadReading {
  block: bigint;
  readAt: Date;
  ageMs: number;
}

export interface Freshness {
  chainId: number;
  checkedAt: Date;
  verdict: OverallVerdict;
  summary: string;
  daemon: DaemonFreshness;
  head: HeadReading | null;
  jobs: JobFreshness[];
  figures: FigureFreshness[];
  swapIndexer: SwapIndexerReading;
  scouting?: ScoutingCoverage;
  lookalikes?: LookalikeCoverage & { measuredAt: string };
}

interface JobVerdictInput {
  cadenceMs: number;
  lastRun: { ok: boolean | null } | null;
  lastOkAgeMs: number | null;
  lastFinishedOk?: boolean | null;
  behind: bigint | null;
  // How long ago the scanner's checkpoint last moved; null for jobs without one.
  checkpointAgeMs?: number | null;
  metadataBacklog?: Pick<TokenMetadataBacklog, "due" | "errors"> | null;
  metricCoverage?: MetricCoverageMap | null;
}

// A filling scanner whose checkpoint has not moved for this long is stuck.
export const STALL_FLOOR_MS = 30 * 60_000;

// A ten-second job whose run takes fifteen seconds is not late; "late" needs
// at least this much silence, whatever the cadence.
export const LATE_FLOOR_MS = 60_000;

// Failing outranks everything: a stalled backfill with an error is not
// "filling". Filling outranks late because a scanner mid-history runs for
// hours between successful runs.
export function jobVerdict(input: JobVerdictInput): JobVerdict {
  if (!input.lastRun) {
    return "never";
  }
  if (input.lastRun.ok === false || (input.lastRun.ok === null && input.lastFinishedOk === false)) {
    return "failing";
  }
  const coverage = Object.values(input.metricCoverage ?? {});
  if (coverage.some(metric => metric.failed > 0)) return "failing";
  // A scanner reading history in windows may not finish a run for hours (a
  // restart ends the run before it can), but every window it commits moves
  // its checkpoint. A moving checkpoint is progress; a still one is a stall.
  if (stillFilling(input.behind)) {
    const stallAfter = Math.max(2 * input.cadenceMs, STALL_FLOOR_MS);
    return input.checkpointAgeMs !== undefined && input.checkpointAgeMs !== null && input.checkpointAgeMs > stallAfter ? "stalled" : "filling";
  }
  if (input.lastOkAgeMs === null) {
    return "never";
  }
  if (input.lastOkAgeMs > Math.max(2 * input.cadenceMs, LATE_FLOOR_MS)) {
    return "late";
  }
  if (input.metadataBacklog && (input.metadataBacklog.due > 0 || input.metadataBacklog.errors > 0)) return "filling";
  if (coverage.some(metric => metric.current < metric.eligible)) return "filling";
  return "fresh";
}

export function overallVerdict(daemonAgeMs: number | null, jobs: Array<{ verdict: JobVerdict }>): OverallVerdict {
  if (jobs.length > 0 && jobs.every((job) => job.verdict === "never")) {
    return "never";
  }
  if (daemonAgeMs === null || daemonAgeMs > DAEMON_STALE_MS) {
    return "stale";
  }
  if (jobs.filter(jobNotCurrent).length >= DEGRADED_JOB_THRESHOLD) {
    return "degraded";
  }
  return "live";
}

function jobNotCurrent(job: { verdict: JobVerdict }): boolean {
  return job.verdict === "failing" || job.verdict === "late" || job.verdict === "never" || job.verdict === "stalled";
}

export function durationText(ms: number | null): string {
  if (ms === null) {
    return "never";
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) {
    return `${seconds} s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) {
    return `${minutes} min`;
  }
  const hours = minutes / 60;
  if (hours < 48) {
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} h`;
  }
  return `${Math.round(hours / 24)} d`;
}

// Blocks per hour from the checkpoint's own movement over the last hour: the
// oldest sample in the window against the block now. Two samples at least,
// and at least a minute apart, or there is no rate to speak of.
export function rateFromSamples(samples: Array<{ blockNumber: bigint; at: Date }>, block: bigint, now: Date): number | null {
  const oldest = samples[0];
  if (!oldest) {
    return null;
  }
  const elapsedMs = now.getTime() - oldest.at.getTime();
  if (elapsedMs < 60_000 || block <= oldest.blockNumber) {
    return null;
  }
  return (Number(block - oldest.blockNumber) * HOUR_MS) / elapsedMs;
}



async function latestHead(chainId: number): Promise<{ block: bigint; readAt: Date } | null> {
  const rows = await db
    .select({ block: chainHealth.headBlock, readAt: chainHealth.checkedAt })
    .from(chainHealth)
    .where(eq(chainHealth.chainId, chainId))
    .orderBy(desc(chainHealth.checkedAt))
    .limit(1);
  return rows[0] ?? null;
}

type CheckpointRow = typeof syncCheckpoints.$inferSelect;

async function jobCheckpoints(chainId: number): Promise<Map<string, CheckpointRow>> {
  const names = Object.values(JOB_CHECKPOINTS).flatMap((list) => list.map((name) => `${name}:${chainId}`));
  const rows = await db.select().from(syncCheckpoints).where(inArray(syncCheckpoints.name, names));
  return new Map(rows.map((row) => [row.name, row]));
}

interface JobsReading {
  daemon: DaemonFreshness;
  head: HeadReading | null;
  jobs: JobFreshness[];
  checkpoints: Map<string, CheckpointRow>;
}

function checkpointProgress(row: CheckpointRow, head: bigint | null, rate: number | null): CheckpointProgress {
  const behind = head === null ? null : head > row.blockNumber ? head - row.blockNumber : BigInt(0);
  const hoursLeft = behind !== null && rate !== null && rate > 0 ? Number(behind) / rate : null;
  return { name: row.name, block: row.blockNumber, head, behind, updatedAt: row.updatedAt, blocksPerHour: rate, hoursLeft };
}

async function readJobs(chainId: number, now: Date): Promise<JobsReading> {
  const [runs, checkpoints, head, heartbeat] = await Promise.all([readJobRunSnapshots(), jobCheckpoints(chainId), latestHead(chainId), readHeartbeatNamed(REGISTRY_HEARTBEAT)]);
  const since = new Date(now.getTime() - HOUR_MS);
  const samples = await checkpointSamples([...checkpoints.keys()], since);
  const jobs = JOB_NAMES.map(function judge(job): JobFreshness {
    const cadenceMs = JOB_CADENCES[job];
    const lastRun = runs.latest.get(job) ?? null;
    const lastOk = runs.ok.get(job) ?? null;
    const lastFinished = runs.finished.get(job) ?? null;
    const lastOkAt = lastOk?.finishedAt ?? null;
    const ageMs = lastOkAt ? now.getTime() - lastOkAt.getTime() : null;
    const running = lastRun !== null && lastRun.ok === null;
    const rows = (JOB_CHECKPOINTS[job] ?? []).map((name) => checkpoints.get(`${name}:${chainId}`)).filter((row): row is CheckpointRow => row !== undefined);
    const progress = rows.map(function measure(row) {
      return checkpointProgress(row, head?.block ?? null, rateFromSamples(samples.get(row.name) ?? [], row.blockNumber, now));
    });
    const behind = progress.reduce<bigint | null>((worst, point) => (point.behind !== null && (worst === null || point.behind > worst) ? point.behind : worst), null);
    const checkpointAgeMs = rows.length > 0 ? Math.min(...rows.map((row) => now.getTime() - row.updatedAt.getTime())) : null;
    const metadataBacklog = job === "dex-tokens" || job === "dex-token-discovery" ? metadataBacklogFromDetail(lastFinished?.detail) : null;
    const metricCoverage = metricCoverageFromDetail(lastFinished?.detail);
    const verdict = jobVerdict({ cadenceMs, lastRun, lastOkAgeMs: ageMs, behind, checkpointAgeMs, metadataBacklog, metricCoverage, lastFinishedOk: lastFinished?.ok });
    return {
      job,
      cadenceMs,
      lastRunAt: lastRun?.startedAt ?? null,
      lastOkAt,
      ageMs,
      rows: lastOk?.rows ?? null,
      error: verdict === "failing" ? publicDiagnostic(lastRun?.error ?? lastFinished?.error ?? "Observation failed") : null,
      running,
      verdict,
      metadataBacklog,
      metricCoverage,
      checkpoints: progress,
    };
  });
  const beatAge = heartbeat ? now.getTime() - heartbeat.lastBeatAt.getTime() : null;
  const detail = heartbeat?.detail && typeof heartbeat.detail === "object" ? (heartbeat.detail as { jobs?: number; failing?: string[] }) : {};
  return {
    daemon: {
      name: REGISTRY_HEARTBEAT,
      lastBeatAt: heartbeat?.lastBeatAt ?? null,
      ageMs: beatAge,
      alive: beatAge !== null && beatAge <= DAEMON_STALE_MS,
      jobsReported: typeof detail.jobs === "number" ? detail.jobs : null,
      failing: Array.isArray(detail.failing) ? detail.failing.filter((name): name is string => typeof name === "string") : [],
    },
    head: head ? { block: head.block, readAt: head.readAt, ageMs: now.getTime() - head.readAt.getTime() } : null,
    jobs,
    checkpoints,
  };
}

export function summarize(verdict: OverallVerdict, daemon: DaemonFreshness, jobs: JobFreshness[]): string {
  switch (verdict) {
    case "never":
      return "The registry daemon has not completed a run against this database.";
    case "stale":
      return daemon.lastBeatAt ? `The registry daemon last reported ${durationText(daemon.ageMs)} ago; every figure is as old as its last run.` : "The registry daemon has never reported a heartbeat.";
    case "degraded":
    case "live": {
      function named(state: JobVerdict, label: string): string {
        const list = jobs.filter((job) => job.verdict === state).map((job) => job.job);
        return list.length > 0 ? `${label}: ${list.join(", ")}` : "";
      }
      const parts = [named("failing", "failing"), named("late", "late"), named("stalled", "stalled"), named("never", "no completed run yet")].filter(Boolean);
      const count = jobs.filter(jobNotCurrent).length;
      if (count > 0) return `${count} of ${jobs.length} jobs ${count === 1 ? "is" : "are"} not current (${parts.join("; ")}).`;
      const filling = jobs.filter((job) => job.verdict === "filling").map((job) => job.job);
      return filling.length > 0 ? `Every job ran on time; ${filling.join(" and ")} still catching up.` : "Every job ran on time.";
    }
  }
}

export interface RegistryVerdict {
  verdict: OverallVerdict;
  summary: string;
  checkedAt: Date;
}

// The header dot: the overall verdict without the per-figure queries.
export async function registryVerdict(chainId: number): Promise<RegistryVerdict> {
  const now = new Date();
  const reading = await readJobs(chainId, now);
  const verdict = overallVerdict(reading.daemon.ageMs, reading.jobs);
  return { verdict, summary: summarize(verdict, reading.daemon, reading.jobs), checkedAt: now };
}

interface FigureCount {
  newestAt: Date | null;
  count: number;
}

interface FigureSource {
  figure: string;
  what: string;
  job: JobName;
  unit: string;
  // True when every successful run rewrites the timestamp, so a fresh job
  // with an old timestamp is itself a fault. False for rows written only
  // when something happens (an event, a round).
  writtenEveryRun: boolean;
  read: (chainId: number, checkpoints: Map<string, CheckpointRow>) => Promise<FigureCount>;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return value;
  }
  return typeof value === "string" ? new Date(value) : null;
}

// The scanners' "checked at" is when the checkpoint last moved; the oldest
// of a job's checkpoints is the honest one.
function checkpointNewest(checkpoints: Map<string, CheckpointRow>, chainId: number, names: readonly string[]): Date | null {
  const dates = names.map((name) => checkpoints.get(`${name}:${chainId}`)?.updatedAt ?? null);
  if (dates.some((date) => date === null)) {
    return null;
  }
  return dates.reduce<Date | null>((oldest, date) => (oldest === null || (date !== null && date < oldest) ? date : oldest), null);
}

async function countRows(table: PgTable): Promise<number> {
  const rows = await db.select({ count: count() }).from(table);
  return rows[0]?.count ?? 0;
}

const FIGURES: FigureSource[] = [
  {
    figure: "state",
    what: "Multiplier, pending multiplier, pause flags and supply, read from each token's contract",
    job: "token-state",
    unit: "tokens",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryAssetState.stateCheckedAt), count: count(registryAssetState.stateCheckedAt) }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "canonical",
    what: "Recorded beacon dependency matches for listed tokens",
    job: "canonical",
    unit: "tokens",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryAssetState.canonicalCheckedAt), count: count(registryAssetState.canonicalCheckedAt) }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "control",
    what: "The issuer's registry contract: paused, implementation, blocked addresses",
    job: "control-plane",
    unit: "contracts",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryControlState.checkedAt), count: count() }).from(registryControlState).where(eq(registryControlState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "feeds",
    what: "Chainlink price per asset and whether the feed is stale",
    job: "feeds",
    unit: "feeds",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryAssetState.feedCheckedAt), count: count(registryAssetState.feedPrice) }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "quotes",
    what: "Robinhood's bid and ask per token, before the multiplier",
    job: "api-prices",
    unit: "tokens",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryAssetState.apiCheckedAt), count: count(registryAssetState.apiBid) }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "supply-events",
    what: "Every mint and burn, scanned from the logs",
    job: "supply-events",
    unit: "events",
    writtenEveryRun: true,
    read: async function read(chainId, checkpoints) {
      return { newestAt: checkpointNewest(checkpoints, chainId, JOB_CHECKPOINTS["supply-events"] ?? []), count: await countRows(registrySupplyEvents) };
    },
  },
  {
    figure: "multiplier-events",
    what: "Every multiplier change as the contract announced it",
    job: "multiplier-events",
    unit: "events",
    writtenEveryRun: true,
    read: async function read(chainId, checkpoints) {
      return { newestAt: checkpointNewest(checkpoints, chainId, JOB_CHECKPOINTS["multiplier-events"] ?? []), count: await countRows(registryMultiplierEvents) };
    },
  },
  {
    figure: "reconciliation",
    what: "Daily supply residual per token: minted minus burned against the contract's supply",
    job: "supply-snapshot",
    unit: "tokens on the latest day",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db
        .select({ newest: max(registrySupplySnapshots.takenAt), count: count() })
        .from(registrySupplySnapshots)
        .where(sql`${registrySupplySnapshots.day} = (select max(day) from registry_supply_snapshots)`);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "holders",
    what: "Balances per holder and daily activity, applied from every transfer",
    job: "transfer-ledger",
    unit: "balances",
    writtenEveryRun: true,
    read: async function read(chainId, checkpoints) {
      return { newestAt: checkpointNewest(checkpoints, chainId, JOB_CHECKPOINTS["transfer-ledger"] ?? []), count: await countRows(holderBalances) };
    },
  },
  {
    figure: "concentration",
    what: "Top 1, top 10, Gini, and the shares that say where the supply sits — float, pools, issuer, bridge, contracts — once a day",
    job: "concentration",
    unit: "tokens on the latest day",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db
        .select({ newest: max(assetConcentration.takenAt), count: count() })
        .from(assetConcentration)
        .where(sql`${assetConcentration.day} = (select max(day) from asset_concentration)`);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "holder-labels",
    what: "What each holder address is — a DEX pool, the issuer's wallet, a bridge gateway, another contract — which is what turns a supply into a float share",
    job: "holder-labels",
    unit: "addresses named",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db
        .select({ newest: max(holderLabels.checkedAt), count: count() })
        .from(holderLabels)
        .where(sql`${holderLabels.kind} <> 'eoa'`);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "history",
    what: "One row per asset per UTC day of every per-asset number above, refreshed hourly, so a past day can be read back",
    job: "state-daily",
    unit: "assets on the latest day",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db
        .select({ newest: max(assetStateDaily.takenAt), count: count() })
        .from(assetStateDaily)
        .where(sql`${assetStateDaily.day} = (select max(day) from asset_state_daily)`);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "second-source",
    what: "The explorer's own count of holders, transfers and supply per asset",
    job: "second-source",
    unit: "assets",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(registryAssetState.blockscoutCheckedAt), count: count(registryAssetState.blockscoutCheckedAt) }).from(registryAssetState).where(eq(registryAssetState.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "dex",
    what: "Pool price, liquidity and premium to the feed, across Uniswap v4 and v3",
    job: "dex-state",
    unit: "pools",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(dexPools.stateCheckedAt), count: count(dexPools.stateCheckedAt) }).from(dexPools).where(and(eq(dexPools.chainId, chainId), eq(dexPools.canonical, true)));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "swaps",
    what: "Swap events in complete, current 24-hour windows for selected canonical pools. Incomplete and expired windows are excluded.",
    job: "dex-swaps",
    unit: "24-hour swaps in selected pools",
    writtenEveryRun: true,
    read: async function read(chainId) {
      return readCurrentSwapFigure(chainId);
    },
  },
  {
    figure: "bridge",
    what: "L1 escrow against L2 supply per bridged asset",
    job: "bridge-escrow",
    unit: "assets",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(bridgeEscrow.checkedAt), count: count() }).from(bridgeEscrow).where(eq(bridgeEscrow.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "bridge-flows",
    what: "Deposits and withdrawals seen on the L2 gateways",
    job: "bridge-flows",
    unit: "flows",
    writtenEveryRun: true,
    read: async function read(chainId, checkpoints) {
      return { newestAt: checkpointNewest(checkpoints, chainId, JOB_CHECKPOINTS["bridge-flows"] ?? []), count: await countRows(bridgeFlows) };
    },
  },
  {
    figure: "lookalikes",
    what: "ERC-20s that borrow a listed ticker or exact name at another address",
    job: "lookalikes",
    unit: "tokens",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(lookalikeTokens.lastSeenAt), count: count() }).from(lookalikeTokens).where(eq(lookalikeTokens.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "issuer",
    what: "The issuer's PDFs, tracked by the CDN's ETag and Last-Modified",
    job: "issuer-docs",
    unit: "documents",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db.select({ newest: max(issuerDocuments.lastSeenAt), count: count() }).from(issuerDocuments).where(isNull(issuerDocuments.goneAt));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "issuer-pages",
    what: "Pages whose words carry rules, kept as a hash of their text",
    job: "issuer-pages",
    unit: "pages",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db.select({ newest: max(issuerPages.lastSeenAt), count: count() }).from(issuerPages);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "corporate-actions",
    what: "Corporate actions as Robinhood publishes them, tied to each token",
    job: "corporate-actions",
    unit: "actions",
    writtenEveryRun: true,
    read: async function read() {
      const rows = await db.select({ newest: max(registryCorporateActions.updatedAt), count: count() }).from(registryCorporateActions);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "health",
    what: "Head block, block time, base fee, batches, finality, ArbOS version",
    job: "chain-health",
    unit: "readings in the last day",
    writtenEveryRun: true,
    read: async function read(chainId) {
      const rows = await db
        .select({ newest: max(chainHealth.checkedAt), count: count() })
        .from(chainHealth)
        .where(sql`${chainHealth.chainId} = ${chainId} and ${chainHealth.checkedAt} > now() - interval '1 day'`);
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "rounds",
    what: "Chainlink round history per feed, written when a round posts",
    job: "feed-history",
    unit: "rounds",
    writtenEveryRun: false,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(feedRounds.observedAt), count: count() }).from(feedRounds).where(eq(feedRounds.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
  {
    figure: "events",
    what: "The changelog: every change a job noticed, matched to watchers",
    job: "authority-match",
    unit: "events",
    writtenEveryRun: false,
    read: async function read(chainId) {
      const rows = await db.select({ newest: max(authorityEvents.observedAt), count: count() }).from(authorityEvents).where(eq(authorityEvents.chainId, chainId));
      return { newestAt: asDate(rows[0]?.newest), count: rows[0]?.count ?? 0 };
    },
  },
];

function figureVerdict(job: JobFreshness, newestAt: Date | null, ageMs: number | null, writtenEveryRun: boolean): FigureVerdict {
  if (newestAt === null) {
    return "unread";
  }
  if (job.verdict === "fresh" && writtenEveryRun && ageMs !== null && ageMs > 2 * job.cadenceMs) {
    return "late";
  }
  return job.verdict;
}

async function readFigures(chainId: number, now: Date, reading: JobsReading): Promise<FigureFreshness[]> {
  const byJob = new Map(reading.jobs.map((job) => [job.job, job]));
  return Promise.all(
    FIGURES.map(async function measure(source): Promise<FigureFreshness> {
      const job = byJob.get(source.job);
      if (!job) {
        throw new Error(`figure ${source.figure} names a job that is not scheduled: ${source.job}`);
      }
      const { newestAt, count: rows } = await source.read(chainId, reading.checkpoints);
      const ageMs = newestAt ? now.getTime() - newestAt.getTime() : null;
      return { figure: source.figure, what: source.what, job: source.job, cadenceMs: job.cadenceMs, newestAt, ageMs, count: rows, unit: source.unit, verdict: figureVerdict(job, newestAt, ageMs, source.writtenEveryRun) };
    }),
  );
}

export async function freshness(chainId: number): Promise<Freshness> {
  const now = new Date();
  const reading = await readJobs(chainId, now);
  const [figures, swapIndexer, receipt, lookalikes] = await Promise.all([readFigures(chainId, now, reading), readSwapIndexer(chainId), readCoverageReceipt(chainId), getLookalikeCoverage(chainId)]);
  const scouting = receipt ? { ...receipt.scouting, receiptStatus: coverageReceiptStatus(receipt.scouting.measuredAt) } : undefined;
  const verdict = overallVerdict(reading.daemon.ageMs, reading.jobs);
  return { chainId, checkedAt: now, verdict, summary: summarize(verdict, reading.daemon, reading.jobs), daemon: reading.daemon, head: reading.head, jobs: reading.jobs, figures, swapIndexer, scouting, lookalikes: { ...lookalikes, measuredAt: now.toISOString() } };
}
