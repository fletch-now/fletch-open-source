// The registry daemon: the pipelines that keep Fletch's registry a live account
// of Robinhood Chain rather than a copy of Robinhood's list. A second long-lived
// process beside workers/watch.ts, so a slow history scan here never delays an
// alert there. Each job runs on its own cadence, records itself in sync_runs,
// and reschedules with setTimeout so a slow run cannot overlap the next.
//
// Run: tsx workers/registry.ts (scripts/fletch-registry.service on the box).

import { existsSync } from "node:fs";
import { config as loadEnvFile } from "dotenv";
import { JOB_CADENCES, REGISTRY_HEARTBEAT, REGISTRY_HEARTBEAT_MS, type JobName } from "@/lib/registry/authority/cadence";
import type { RunOutcome } from "@/lib/registry/authority/runs";
import { registryStartupDelays } from "@/lib/registry/authority/job-delay";
import { createRegistryJobScheduler, type RegistryJob } from "@/lib/registry/authority/job-scheduler";

for (const file of ["/etc/fletch/fletch.env", ".env.local"]) {
  if (existsSync(file)) {
    loadEnvFile({ path: file });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(function schedule(resolve) {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const { RH_MAINNET_ID } = await import("@/lib/config");
  const authority = await import("@/lib/registry/authority");
  const { matchAuthorityEvents } = await import("@/lib/watch/authority");
  const { matchNewPools } = await import("@/lib/watch/new-pools");
  const { beatAs } = await import("@/lib/watch/heartbeat");
  const { logEvent } = await import("@/lib/log");
  const { close, pool } = await import("@/lib/db");

  const { backfillMarketSwaps } = await import("@/lib/registry/authority/market-swaps");
  const { processMarketRefreshRequests } = await import("@/lib/registry/authority/market-refresh-worker");
  const { syncAppCatalog } = await import("@/lib/registry/app-catalog");
  const { scoutExplorerCatalog } = await import("@/lib/registry/explorer-scouting");
  const { configureBlockscoutAccounting } = await import("@/lib/registry/authority/blockscout");
  const { explorerAccounting } = await import("@/lib/registry/explorer-provider");
  configureBlockscoutAccounting(explorerAccounting);
  const priority = await import("@/lib/registry/priority-jobs");
  const chainId = RH_MAINNET_ID;
  // Every job is named in JOB_CADENCES, so the freshness read and this loop
  // cannot disagree on what runs and how often.
  function job(name: JobName, work: () => Promise<RunOutcome>): RegistryJob {
    const everyMs = JOB_CADENCES[name];
    return { name, everyMs, run: () => authority.recordRun(name, work) };
  }
  const jobs: RegistryJob[] = [
    job("app-catalog", () => syncAppCatalog(chainId)),
    job("explorer-scouting", () => scoutExplorerCatalog(chainId)),
    job("stock-pair-history", () => authority.backfillStockPairings(chainId)),
    job("control-plane", () => authority.scanControlPlane(chainId)),
    job("authority-match", () => matchAuthorityEvents(chainId)),
    job("new-pool-match", () => matchNewPools(chainId)),
    job("chain-health", () => authority.recordChainHealth(chainId)),
    job("feeds", () => authority.refreshFeeds(chainId)),
    job("supply-events", () => authority.scanSupplyEvents(chainId)),
    job("multiplier-events", () => authority.scanMultiplierEvents(chainId)),
    job("token-state", () => authority.refreshTokenState(chainId)),
    job("api-prices", () => authority.refreshApiPrices(chainId)),
    job("corporate-actions", () => authority.syncCorporateActions(chainId)),
    job("canonical", () => authority.checkCanonical(chainId)),
    job("bridged", () => authority.syncBridgedAssets(chainId)),
    job("transfer-ledger", () => authority.scanTransferLedger(chainId)),
    job("holder-labels", () => authority.refreshHolderLabels(chainId)),
    job("concentration", () => authority.snapshotConcentration(chainId)),
    job("dex-pools", () => authority.discoverPools(chainId)),
    job("dex-pools-v3", () => authority.discoverV3Pools(chainId)),
    job("dex-state", () => priority.refreshPriorityState(chainId)),
    job("priority-universe", () => priority.refreshPriorityMembership(chainId)),
    job("priority-holders", () => priority.refreshPriorityHolderSnapshot(chainId)),
    job("dex-tokens", () => priority.refreshPriorityTokenMetadata(chainId)),
    job("dex-token-discovery", () => priority.refreshDiscoveredTokenMetadata(chainId)),
    job("priority-supply", () => priority.refreshPriorityTokenSupply(chainId)),
    job("dex-prices", () => priority.samplePriorityPrices(chainId)),
    job("dex-tiers", () => authority.retierPools(chainId)),
    job("dex-swaps", () => authority.scanSwaps(chainId)),
    job("dex-swap-backfill", () => backfillMarketSwaps(chainId)),
    job("market-refresh", () => processMarketRefreshRequests(chainId)),
    job("bridge-flows", () => authority.scanBridgeFlows(chainId)),
    job("bridge-escrow", () => authority.refreshBridgeEscrow(chainId)),
    job("issuer-docs", () => authority.syncIssuerDocuments(chainId)),
    job("issuer-pages", () => authority.syncIssuerPages(chainId)),
    job("feed-history", () => authority.backfillFeedRounds(chainId)),
    job("second-source", () => authority.refreshSecondSource(chainId)),
    job("lookalikes", () => authority.scanLookalikes(chainId)),
    job("supply-snapshot", () => authority.snapshotSupply(chainId)),
    job("state-daily", () => authority.snapshotStateDaily(chainId)),
  ];

  let stopping = false;
  const scheduler = createRegistryJobScheduler(pool.options.max, function crashed(job, cause): void {
    logEvent("registry", { event: "job-crashed", job, error: cause instanceof Error ? cause.message : String(cause) });
  });

  async function heartbeatLoop(): Promise<void> {
    while (!stopping) {
      try {
        const runs = await authority.lastRuns();
        const failing = runs.filter((run) => run.ok === false).map((run) => run.job);
        await beatAs(REGISTRY_HEARTBEAT, null, { jobs: runs.length, failing, queued: scheduler.queued });
      } catch (cause) {
        logEvent("registry", { event: "heartbeat-failed", error: cause instanceof Error ? cause.message : String(cause) });
      }
      await sleep(REGISTRY_HEARTBEAT_MS);
    }
  }

  logEvent("registry", { event: "start", chainId, poolMax: pool.options.max, jobs: jobs.map((job) => `${job.name}@${job.everyMs / 1000}s`) });
  const startupDelays = registryStartupDelays(JOB_CADENCES);
  for (const job of jobs) {
    scheduler.schedule(job, startupDelays.get(job.name)!);
  }
  void heartbeatLoop();

  async function shutdown(signal: string): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;
    logEvent("registry", { event: "shutdown", signal, running: scheduler.running, queued: scheduler.queued });
    scheduler.stop();
    const deadline = Date.now() + 30_000;
    while (scheduler.running.length > 0 && Date.now() < deadline) {
      await sleep(100);
    }
    await close();
    logEvent("registry", { event: "shutdown-complete" });
    process.exit(0);
  }
  process.on("SIGTERM", function onSigterm() {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", function onSigint() {
    void shutdown("SIGINT");
  });
}

main().catch(function fatal(cause) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), scope: "registry", event: "fatal", error: cause instanceof Error ? cause.stack : String(cause) }));
  process.exit(1);
});
