import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import {
  buildsPerDay,
  deliveriesPerDay,
  listAudit,
  listBuilds,
  platformCounts,
  registrySummary,
  signupsPerDay,
  systemStatus,
} from "@/lib/admin/queries";
import { NoticeBar, PageHeader, Panel, Sparkline, Stat, StatGrid, StatusChip, Table, Time, buildStatusTone } from "@/components/dashboard/ui";
import { DayBars } from "@/components/admin/day-bars";
import { ageSeconds, formatAge, formatDuration, percent, shortId } from "@/components/admin/format";
import { RH_MAINNET_ID } from "@/lib/config";
import { PRICE_PER_CREDIT_USDG } from "@/lib/payments/usdg";

// The bird's-eye view. Four questions, in order: is anything broken right now,
// how much is the platform being used, is it succeeding, and what changed last.
// Every number is a live query; there is no cached summary table to drift.

const HEARTBEAT_FRESH_SECONDS = 60;

export default async function AdminOverviewPage() {
  await requireAdmin();
  const [counts, builds, alerts, signups, registry, system, recentBuilds, recentAudit] = await Promise.all([
    platformCounts(),
    buildsPerDay(14),
    deliveriesPerDay(14),
    signupsPerDay(14),
    registrySummary(),
    systemStatus(),
    listBuilds({ limit: 8 }),
    listAudit({ limit: 8 }),
  ]);

  const beatAge = ageSeconds(system.heartbeat?.lastBeatAt ?? null);
  const daemonDown = beatAge === null || beatAge > HEARTBEAT_FRESH_SECONDS;
  const mainnetRpc = system.rpc.find((row) => row.chainId === RH_MAINNET_ID);
  const successRate = percent(counts.buildsSucceeded7d, counts.buildsSucceeded7d + counts.buildsFailed7d);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Overview"
        description="Every account, build, watcher and delivery on Fletch, and whether the machine behind them is healthy right now."
      />

      {daemonDown ? (
        <NoticeBar
          tone="bad"
          action={
            <Link href="/trafalgar/system" className="text-[12.5px] underline underline-offset-4">
              System
            </Link>
          }
        >
          The Watch daemon has not reported {beatAge === null ? "at all" : `for ${formatAge(beatAge)}`}. Every enabled
          watcher is standing still until it does.
        </NoticeBar>
      ) : null}
      {mainnetRpc && !mainnetRpc.configured ? (
        <NoticeBar tone="warn">
          Chain {RH_MAINNET_ID} is on Robinhood&apos;s public RPC. It is rate-limited and not meant for production; set
          RPC_URL_{RH_MAINNET_ID} to a paid provider before alerts matter to anyone.
        </NoticeBar>
      ) : null}
      {!system.telegramConfigured ? (
        <NoticeBar tone="warn">
          No Telegram bot is configured, so nobody can link an account and every matched transfer fails delivery with
          &quot;telegram not linked&quot;. Set the three TELEGRAM_* variables and register the webhook.
        </NoticeBar>
      ) : null}
      {counts.deliveriesFailed24h > 0 ? (
        <NoticeBar
          tone="warn"
          action={
            <Link href="/trafalgar/deliveries?status=failed" className="text-[12.5px] underline underline-offset-4">
              Failed deliveries
            </Link>
          }
        >
          {counts.deliveriesFailed24h} alert{counts.deliveriesFailed24h === 1 ? "" : "s"} failed to deliver in the last 24
          hours.
        </NoticeBar>
      ) : null}
      {!system.provider ? (
        <NoticeBar tone="bad">
          No model key is set. Every build fails cleanly and refunds; nothing is being written.
        </NoticeBar>
      ) : null}

      <div className="mb-4">
        <StatGrid>
          <Stat
            label="Accounts"
            value={counts.users}
            hint={`${counts.signups24h} today · ${counts.signups7d} this week`}
            href="/trafalgar/users"
          />
          <Stat
            label="Builds, 7 days"
            value={counts.builds7d}
            hint={`${successRate} succeeded · ${counts.buildsFailed7d} failed`}
            href="/trafalgar/builds"
          />
          <Stat
            label="Building now"
            value={counts.buildsRunning}
            hint={`of ${system.sandbox.maxConcurrent} sandbox slots`}
            tone={counts.buildsRunning >= system.sandbox.maxConcurrent ? "warn" : "neutral"}
            href="/trafalgar/builds?status=running"
          />
          <Stat
            label="Credits spent"
            value={counts.creditsSpent}
            hint={`${counts.creditsGranted} granted, ${counts.creditsRefunded} refunded, ${counts.purchases} purchase${counts.purchases === 1 ? "" : "s"} for ${(counts.creditsPurchased * PRICE_PER_CREDIT_USDG).toFixed(2)} USDG`}
          />
        </StatGrid>
      </div>

      <div className="mb-6">
        <StatGrid>
          <Stat
            label="Watchers enabled"
            value={counts.watchersEnabled}
            hint={counts.watchersDegraded > 0 ? `${counts.watchersDegraded} degraded` : `${counts.watchersTotal} total`}
            tone={counts.watchersDegraded > 0 ? "warn" : "neutral"}
            href="/trafalgar/watchers"
          />
          <Stat
            label="Alerts, 24h"
            value={counts.deliveries24h}
            hint={counts.deliveriesPending > 0 ? `${counts.deliveriesPending} waiting to send` : "queue empty"}
            tone={counts.deliveriesFailed24h > 0 ? "bad" : "neutral"}
            href="/trafalgar/deliveries"
          />
          <Stat
            label="Registry assets"
            value={registry.total}
            hint={`${registry.verified} verified on chain`}
            href="/trafalgar/registry"
          />
          <Stat
            label="Watch daemon"
            value={daemonDown ? "down" : "up"}
            hint={
              system.heartbeat
                ? `beat ${formatAge(beatAge)} ago · head ${system.heartbeat.headBlock?.toString() ?? "—"}`
                : "never reported"
            }
            tone={daemonDown ? "bad" : "good"}
            href="/trafalgar/system"
          />
        </StatGrid>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Builds per day" description="Green succeeded, red failed, grey still running or never started.">
          <div className="px-5 py-4">
            <DayBars points={builds} okLabel="succeeded" badLabel="failed" />
          </div>
        </Panel>
        <Panel title="Alerts per day" description="Green delivered to Telegram, red failed after every retry.">
          <div className="px-5 py-4">
            <DayBars points={alerts} okLabel="sent" badLabel="failed" />
          </div>
        </Panel>
        <Panel title="Sign-ups per day" description="New wallets, whether or not they went on to build.">
          <div className="flex flex-col gap-3 px-5 py-4">
            <Sparkline points={signups.map((point) => point.total)} width={260} height={64} tone="good" />
            <p className="font-mono text-[11px] text-ink-faint">
              {signups[0]?.day} → {signups[signups.length - 1]?.day} · {counts.signups7d} in the last 7 days
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel
          title="Latest builds"
          description="Newest first. Open one for its full event log."
          actions={
            <Link href="/trafalgar/builds" className="text-[12.5px] text-hood-deep underline underline-offset-4">
              All builds
            </Link>
          }
        >
          {recentBuilds.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-ink-soft">No builds yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recentBuilds.map(function renderBuild(build) {
                return (
                  <li key={build.id} className="flex items-center gap-3 px-5 py-3">
                    <StatusChip tone={buildStatusTone(build.status)}>{build.status}</StatusChip>
                    <Link href={`/trafalgar/builds/${build.id}`} className="min-w-0 flex-1 truncate text-[13px] text-ink hover:underline">
                      {build.prompt}
                    </Link>
                    <span className="shrink-0 text-[12px] text-ink-faint">{build.userName ?? shortId(build.userId)}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-faint">{formatDuration(build.durationSeconds)}</span>
                    <Time at={build.createdAt} className="shrink-0 font-mono text-[11.5px] text-ink-faint" />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel
          title="Latest audit entries"
          description="Every sensitive change, by whom. Operator actions from this console land here too."
          actions={
            <Link href="/trafalgar/audit" className="text-[12.5px] text-hood-deep underline underline-offset-4">
              Full trail
            </Link>
          }
        >
          {recentAudit.length === 0 ? (
            <p className="px-5 py-6 text-[13.5px] text-ink-soft">Nothing recorded yet.</p>
          ) : (
            <Table
              dense
              flush
              columns={[
                { key: "action", label: "action" },
                { key: "who", label: "who" },
                { key: "resource", label: "resource" },
                { key: "when", label: "when", align: "right" },
              ]}
              rows={recentAudit.map(function renderEntry(entry) {
                return [
                  <span key="a" className="font-mono text-[12px]">{entry.action}</span>,
                  entry.userName ?? entry.actorType,
                  <span key="r" className="font-mono text-[11.5px] text-ink-faint">
                    {entry.resourceType ? `${entry.resourceType} ${shortId(entry.resourceId ?? "")}` : "—"}
                  </span>,
                  <Time key="t" at={entry.createdAt} className="font-mono text-[11.5px] text-ink-faint" />,
                ];
              })}
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
