import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { authorityCounts, listRegistry, registrySummary } from "@/lib/admin/queries";
import { syncRegistryNow } from "@/lib/admin/actions";
import { SimpleAction } from "@/components/admin/action-form";
import { EmptyState, NoticeBar, PageHeader, Panel, Stat, StatGrid, StatusChip, Table, Time } from "@/components/dashboard/ui";
import { CheckpointedScanners, JobTable } from "@/components/registry/freshness-panel";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { ROBINHOOD_ASSETS_ENDPOINT } from "@/lib/registry/robinhood";
import { RH_MAINNET_ID } from "@/lib/config";
import { ageMinutes, formatAge } from "@/components/admin/format";
import { freshness, type OverallVerdict } from "@/lib/registry/authority/freshness";
import { authoritySummary, lookalikeTotals } from "@/lib/registry/authority/read";
import type { StatTone } from "@/components/dashboard/ui/stat";

const STALE_SYNC_MINUTES = 45;

const VERDICT_TONE: Record<OverallVerdict, StatTone> = {
  live: "good",
  degraded: "warn",
  stale: "bad",
  never: "neutral",
};

const VERDICT_NOTICE: Record<OverallVerdict, "bad" | "warn" | null> = {
  live: null,
  degraded: "warn",
  stale: "bad",
  never: "warn",
};

// The listing every watcher is built from, and the daemon that keeps its
// state live. The freshness reading is the one /registry/status publishes;
// this page adds the operator's view: what to run on the box when a job is
// failing, and how much of each table has been read.
export default async function AdminRegistryPage({ searchParams }: PageProps<"/trafalgar/registry">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const [summary, assets, reading, authority, lookalikes, counts] = await Promise.all([
    registrySummary(),
    listRegistry(q),
    freshness(RH_MAINNET_ID),
    authoritySummary(RH_MAINNET_ID),
    lookalikeTotals(RH_MAINNET_ID),
    authorityCounts(),
  ]);
  const syncAgeMinutes = ageMinutes(summary.lastObservedAt);
  const stale = syncAgeMinutes === null || syncAgeMinutes > STALE_SYNC_MINUTES;
  const failing = reading.jobs.filter((job) => job.verdict === "failing");
  const filling = reading.jobs.filter((job) => job.verdict === "filling");
  const notice = VERDICT_NOTICE[reading.verdict];
  const stockTokens = summary.byType.find((entry) => entry.assetType === "stock_token")?.count ?? 0;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Registry"
        description={`Chain ${RH_MAINNET_ID}. The listing is synced from ${ROBINHOOD_ASSETS_ENDPOINT} every 15 minutes; the registry daemon (fletch-registry.service) keeps every token's live state. The same freshness reading is public at /registry/status.`}
        actions={<SimpleAction action={syncRegistryNow} label="Sync listing now" tone="primary" />}
      />

      {notice ? (
        <NoticeBar tone={notice}>
          Registry daemon is <strong>{reading.verdict}</strong>: {reading.summary} On the box:{" "}
          <code className="font-mono">fletch-ops registry</code>, then <code className="font-mono">journalctl -u fletch-registry -n 200</code>.
        </NoticeBar>
      ) : null}
      {failing.length > 0 ? (
        <NoticeBar tone="warn">
          Failing now: {failing.map((job) => `${job.job} (${job.error ?? "no error recorded"})`).join("; ")}. A failed run retries within a minute; the public RPC&apos;s
          rate limit is the usual cause and clears on its own.
        </NoticeBar>
      ) : null}
      {stale ? (
        <NoticeBar tone="warn">
          {syncAgeMinutes === null
            ? "The listing has never been synced. Install the fletch-registry-sync timer (docs/DEPLOY.md §9) or run Sync now."
            : `Last listing sync was ${syncAgeMinutes} minutes ago; the timer runs every 15. Check fletch-registry-sync.timer on the box.`}
        </NoticeBar>
      ) : null}

      <div className="mb-6">
        <StatGrid>
          <Stat label="Registry daemon" value={reading.verdict} hint={reading.daemon.lastBeatAt ? `heartbeat ${formatAge(reading.daemon.ageMs === null ? null : Math.round(reading.daemon.ageMs / 1000))} ago` : "never reported"} tone={VERDICT_TONE[reading.verdict]} href="/registry/status" />
          <Stat label="Assets" value={summary.total} hint={summary.byType.map((entry) => `${entry.count} ${entry.assetType.replace("_", " ")}`).join(" · ")} />
          <Stat label="Verified on chain" value={summary.verified} hint={`${summary.total - summary.verified} without bytecode yet`} tone={summary.verified === summary.total ? "good" : "warn"} />
          <Stat label="Beacon matches" value={`${authority.canonical} / ${stockTokens}`} hint="beacon slot is the issuer's registry" tone={authority.canonical === stockTokens && stockTokens > 0 ? "good" : "warn"} />
          <Stat label="Issuer registry" value={authority.registryPaused === null ? "not read" : authority.registryPaused ? "paused" : "live"} hint={`${authority.blockedAddresses ?? "?"} addresses blocked`} tone={authority.registryPaused ? "bad" : "good"} />
          <Stat label="Chainlink feeds" value={`${authority.feedsRead} read`} hint={`${authority.feedsStale} stale · ${counts.feedRounds.toLocaleString("en-US")} rounds on record`} tone={authority.feedsStale > 0 ? "warn" : "good"} />
          <Stat label="Supply reconciled" value={authority.supplySnapshotDay ? `${authority.supplyMismatches} residuals` : "pending"} hint={authority.supplySnapshotDay ? `snapshot ${authority.supplySnapshotDay}` : "first pass not finished"} tone={authority.supplyMismatches > 0 ? "warn" : "good"} />
          <Stat label="Lookalikes" value={lookalikes.total.toLocaleString("en-US")} hint={`${lookalikes.exactName} with the exact name; identities remain subject to listing and contract checks`} tone="neutral" href="/registry/lookalikes" />
          <Stat label="Last listing sync" value={syncAgeMinutes === null ? "never" : `${syncAgeMinutes}m ago`} hint={summary.lastVerifiedAt ? `last verification ${summary.lastVerifiedAt.toISOString().slice(0, 16).replace("T", " ")}` : "no verification yet"} tone={stale ? "warn" : "good"} />
          <Stat label="Holder ledger" value={counts.holderBalances.toLocaleString("en-US")} hint="balances applied" />
          <Stat label="DEX pools" value={counts.dexPools.toLocaleString("en-US")} hint={`${counts.dexPriced.toLocaleString("en-US")} dollar-priced`} />
          <Stat label="Bridge flows" value={counts.bridgeFlows.toLocaleString("en-US")} hint={`${counts.bridgeFlows24h} in the last 24 h`} />
          <Stat label="Issuer documents" value={counts.issuerDocuments} hint="tracked by CDN ETag" href="/registry/issuer" />
          <Stat label="Events, 24 h" value={counts.eventsToday} hint={counts.eventsUnmatched > 0 ? `${counts.eventsUnmatched} not yet matched to watchers` : "all matched to watchers"} tone={counts.eventsUnmatched > 0 ? "warn" : "neutral"} href="/registry/changes" />
        </StatGrid>
      </div>

      {filling.length > 0 ? (
        <div className="mb-6">
          <Panel title="Scanners still reading history" description="A first pass over the chain's history on the public RPC takes hours to days; a keyed RPC_URL_4663 turns that into minutes. Figures from these scanners are partial until they reach head, and the public pages say so.">
            <CheckpointedScanners jobs={reading.jobs} />
          </Panel>
        </div>
      ) : null}

      <div className="mb-6">
        <Panel
          title="Every job against its cadence"
          description="The scheduler and this table read the same cadence map, so 'late' means late by the number the daemon actually uses."
          actions={
            <Link href="/registry/status" className="text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
              public status page
            </Link>
          }
        >
          <JobTable jobs={reading.jobs} />
        </Panel>
      </div>

      <form method="get" className="mb-4 flex items-center gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="symbol, name, or address"
          className="h-9 w-64 rounded-full border border-line bg-paper px-4 text-[13px] text-ink placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
        />
        <button type="submit" className="h-9 rounded-full bg-ink px-4 text-[12.5px] font-medium text-paper">
          Search
        </button>
        <Link href="/dashboard/registry" className="ml-auto text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
          open with live state and filters
        </Link>
      </form>

      {assets.length === 0 ? (
        <EmptyState title={q ? "No asset matches" : "Registry is empty"} body={q ? "Try a ticker symbol." : "Run Sync now to fill it."} />
      ) : (
        <Table
          dense
          columns={[
            { key: "symbol", label: "symbol" },
            { key: "name", label: "name" },
            { key: "type", label: "type" },
            { key: "address", label: "address" },
            { key: "verified", label: "verified" },
            { key: "observed", label: "observed", align: "right" },
          ]}
          rows={assets.map(function renderAsset(asset) {
            return [
              <Link key="s" href={`/registry/${asset.symbol}`} className="font-mono text-[12.5px] font-medium text-ink underline-offset-4 hover:underline">
                {asset.symbol}
              </Link>,
              <span key="n" className="text-ink-soft">{asset.name}</span>,
              <span key="t" className="text-[12px] text-ink-faint">{asset.assetType.replace("_", " ")}</span>,
              <a
                key="a"
                href={explorerAddressUrl(asset.chainId, asset.address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11.5px] text-ink-soft underline-offset-4 hover:underline"
              >
                {asset.address}
              </a>,
              asset.verifiedAt ? <StatusChip key="v" tone="good">verified</StatusChip> : <StatusChip key="v" tone="warn">no bytecode</StatusChip>,
              <Time key="o" at={asset.observedAt} className="font-mono text-[11.5px] text-ink-faint" />,
            ];
          })}
        />
      )}
    </div>
  );
}
