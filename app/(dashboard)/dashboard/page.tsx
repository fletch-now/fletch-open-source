import Link from "@/components/ui/navigation-link";
import { desc, eq, sql } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { DeliveryList } from "@/components/dashboard/watch/delivery-list";
import { db } from "@/lib/db";
import { builds, contracts, creditEvents, projects, walletAddress } from "@/lib/db/schema";
import { getBalance } from "@/lib/credits";
import { LiveCreditBalance } from "@/components/holder-rewards/client";
import { robinhoodTestnet } from "@/lib/chains";
import { RH_MAINNET_ID, RH_TESTNET_ID, STARTER_CREDITS } from "@/lib/config";
import { PayButton } from "@/components/pay-button";
import { treasuryAddress } from "@/lib/payments/treasury";
import { PRICE_PER_CREDIT_USDG } from "@/lib/payments/usdg";
import { getDeliveryStats, listDeliveriesForUser, listWatchersForUser } from "@/lib/watch/queries";
import type { WatcherRow } from "@/lib/watch/queries";
import { readHeartbeat } from "@/lib/watch/heartbeat";
import { usingPublicLogRpc } from "@/lib/chain/rpc";
import { getTelegramAccount } from "@/lib/telegram/link";
import { EmptyState, NoticeBar, PageHeader, Panel, Stat, StatGrid, StatusChip, Time, buildStatusTone } from "@/components/dashboard/ui";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";
import { formatAge } from "@/components/admin/format";

const REASON_LABEL: Record<string, string> = {
  free_grant: "Welcome credits",
  holder_grant: "$FLTX holder credits",
  build_debit: "Build",
  build_reserve: "Build allowance reserved",
  build_release: "Build allowance released",
  refund: "Refund",
  admin_adjust: "Adjustment",
  purchase: "Purchase",
};

// Matches watch/page.tsx's own threshold — the daemon is the same process either
// place reads it, so "watching" should mean the same age everywhere it appears.
const HEARTBEAT_FRESH_SECONDS = 60;
const RECENT_ALERTS_LIMIT = 3;

function testnetExplorer(address: string): string {
  const base = robinhoodTestnet.blockExplorers?.default.url ?? "";
  return `${base}/address/${address}`;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function heartbeatAgeSeconds(lastBeatAt: Date | null): number | null {
  if (!lastBeatAt) {
    return null;
  }
  return Math.round((Date.now() - lastBeatAt.getTime()) / 1000);
}

// "Watchers" answers not just how many but whether they're doing their job —
// a count alone hides a watcher stuck catching up or degraded.
function watcherBreakdown(rows: WatcherRow[]): string {
  const enabled = rows.filter((row) => row.enabled);
  if (enabled.length === 0) {
    return "none enabled";
  }
  const active = enabled.filter((row) => row.status === "active").length;
  if (active === enabled.length) {
    return "all active";
  }
  const catchingUp = enabled.filter((row) => row.status === "catching_up").length;
  const degraded = enabled.filter((row) => row.status === "degraded").length;
  const parts: string[] = [];
  if (active > 0) {
    parts.push(`${active} active`);
  }
  if (catchingUp > 0) {
    parts.push(`${catchingUp} catching up`);
  }
  if (degraded > 0) {
    parts.push(`${degraded} degraded`);
  }
  return parts.join(" · ");
}

function alertsHint(failed24h: number, onPublicRpc: boolean): string {
  if (failed24h > 0) {
    return `${failed24h} failed`;
  }
  if (onPublicRpc) {
    return "on the public RPC";
  }
  return " ";
}

// The three things Fletch does, in one line each, so a first visit explains
// itself without a tour. Shown until the account has used all three.
const AREAS = [
  {
    title: "Build",
    href: "/dashboard/build",
    body: "Describe an app. An agent writes the Solidity and a small front end, and Foundry compiles and tests it in a sandbox. One credit per build, refunded if it fails to compile.",
  },
  {
    title: "Watch",
    href: "/dashboard/watch",
    body: "Pick a verified Stock Token, set a threshold, and link Telegram once. A daemon on Fletch's server checks each block and messages you when a transfer clears it, whether or not you are here.",
  },
  {
    title: "Registry",
    href: "/dashboard/registry",
    body: "Each Stock Token Robinhood lists on chain 4663, checked for bytecode on chain before it is marked verified. Watchers can only be pointed at addresses from this list.",
  },
];

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Your builds and alerts will live here"
        body="Connect a wallet to see credits, every app you have built, every watcher you keep running, and the alerts they have sent."
      />
    );
  }
  const userId = session.user.id;

  const [
    wallets,
    balance,
    userProjects,
    recentBuilds,
    ledger,
    projectCountRows,
    watcherRows,
    deliveryStats,
    heartbeat,
    recentAlerts,
    contractRows,
    telegramAccount,
  ] = await Promise.all([
    db.select().from(walletAddress).where(eq(walletAddress.userId, userId)),
    getBalance(userId),
    db.select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt)).limit(12),
    db.select().from(builds).where(eq(builds.userId, userId)).orderBy(desc(builds.createdAt)).limit(8),
    db.select().from(creditEvents).where(eq(creditEvents.userId, userId)).orderBy(desc(creditEvents.createdAt)).limit(8),
    db.select({ n: sql<string>`count(*)` }).from(projects).where(eq(projects.userId, userId)),
    listWatchersForUser(userId),
    getDeliveryStats(userId),
    readHeartbeat(),
    listDeliveriesForUser(userId, RECENT_ALERTS_LIMIT),
    db
      .select({ projectId: builds.projectId, chainId: contracts.chainId, address: contracts.address })
      .from(contracts)
      .innerJoin(builds, eq(contracts.buildId, builds.id))
      .where(eq(builds.userId, userId)),
    getTelegramAccount(userId),
  ]);

  const testnetByProject = new Map<string, string>();
  for (const row of contractRows) {
    if (row.projectId && row.chainId === RH_TESTNET_ID) {
      testnetByProject.set(row.projectId, row.address);
    }
  }

  const projectCount = Number(projectCountRows[0]?.n ?? 0);
  const uniqueWallets = Array.from(new Map(wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])).values());
  const enabledWatcherCount = watcherRows.filter((row) => row.enabled).length;
  const beatAge = heartbeatAgeSeconds(heartbeat?.lastBeatAt ?? null);
  const daemonDown = beatAge === null || beatAge > HEARTBEAT_FRESH_SECONDS;
  const publicRpc = usingPublicLogRpc(RH_MAINNET_ID);
  const buildRunning = recentBuilds.some((build) => RUNNING_BUILD_STATUSES.includes(build.status));
  const hasGrant = ledger.some((event) => event.reason === "free_grant");
  const showAreas = projectCount === 0 || watcherRows.length === 0;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Overview"
        description={`Signed in as ${session.user.name}. What you have built, what you are watching, and what happened last.`}
        actions={
          <>
            <Link
              href="/dashboard/build"
              className="rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
            >
              New build
            </Link>
          </>
        }
      />

      {enabledWatcherCount > 0 && daemonDown ? (
        <NoticeBar tone="bad">
          The Watch daemon has not reported {beatAge === null ? "in a while" : `for ${formatAge(beatAge)}`}. Your watchers
          are standing still until it is back; nothing is lost, they resume from their last checkpoint.
        </NoticeBar>
      ) : null}
      {watcherRows.length > 0 && !telegramAccount ? (
        <NoticeBar
          tone="warn"
          action={
            <Link href="/dashboard/settings" className="text-[12.5px] underline underline-offset-4">
              Notification settings
            </Link>
          }
        >
          Watcher matches appear in your dashboard. Link Telegram in Settings if you also want notifications there.
        </NoticeBar>
      ) : null}
      {balance <= 0 && !buildRunning ? (
        <NoticeBar
          tone="warn"
          action={
            <a href="#buy-credits" className="text-[12.5px] underline underline-offset-4">
              Credit options
            </a>
          }
        >
          {hasGrant
            ? "You have used your credits. Check the credit options below, or connect your own model API key in Settings."
            : `New addresses receive ${STARTER_CREDITS} free build credit at sign-in. Earlier accounts keep their existing grant rules.`}
        </NoticeBar>
      ) : null}

      <div className="mb-6">
        <StatGrid>
          <Stat
            label="Credits"
            value={<LiveCreditBalance initial={balance} withLabel={false} />}
            hint={balance > 0 || hasGrant ? "one per build, refunded on failure" : `${STARTER_CREDITS} free credit for a new address`}
            tone={balance <= 0 ? "warn" : "neutral"}
          />
          <Stat label="Apps" value={projectCount} hint={projectCount === 0 ? "nothing built yet" : "each app is a project"} href="/dashboard/projects" />
          <Stat
            label="Watchers"
            value={enabledWatcherCount}
            hint={watcherBreakdown(watcherRows)}
            tone={watcherRows.some((row) => row.enabled && row.status === "degraded") ? "warn" : "neutral"}
            href="/dashboard/watch"
          />
          <Stat
            label="Alerts, last 24h"
            value={deliveryStats.last24h}
            hint={alertsHint(deliveryStats.failed24h, publicRpc && enabledWatcherCount > 0)}
            tone={deliveryStats.failed24h > 0 ? "bad" : "neutral"}
            href="/dashboard/alerts"
          />
        </StatGrid>
      </div>

      {showAreas ? (
        <div className="mb-6 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3">
          {AREAS.map(function renderArea(area) {
            return (
              <div key={area.title} className="flex flex-col gap-2 bg-raised p-5">
                <Link href={area.href} className="text-[14.5px] font-medium text-ink hover:text-hood-deep">
                  {area.title} →
                </Link>
                <p className="text-[13px] leading-6 text-ink-soft">{area.body}</p>
              </div>
            );
          })}
        </div>
      ) : null}

      {watcherRows.length > 0 ? (
        <div className="mb-6">
          <Panel
            title="Recent alerts"
            description="The last transfers your watchers matched, and whether each reached Telegram."
            actions={
              <Link href="/dashboard/alerts" className="text-[12.5px] text-hood-deep underline underline-offset-4 hover:text-ink">
                View all
              </Link>
            }
          >
            <div className="p-3">
              <DeliveryList
                deliveries={recentAlerts}
                showWatcherName
                emptyState={
                  <p className="px-2 py-4 text-[13.5px] text-ink-soft">
                    No transfer has crossed a threshold yet. An <em>active</em> watcher is enabled. Its scan time shows the latest recorded progress.
                  </p>
                }
              />
            </div>
          </Panel>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Projects" description="Every app you have built. Open one to keep editing it with a follow-up prompt.">
            {userProjects.length === 0 ? (
              <div className="p-3">
                <EmptyState
                  title="Nothing built yet"
                  body="Describe an app in a sentence or two. You get the Solidity, the front end, and the compiler's verdict."
                  action={{ href: "/dashboard/build", label: "Start a build" }}
                />
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {userProjects.map(function renderProject(project) {
                  const testnet = testnetByProject.get(project.id);
                  return (
                    <li key={project.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3">
                      <Link
                        href={`/dashboard/build?project=${project.id}`}
                        className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink transition-colors hover:text-hood-deep"
                      >
                        {project.name}
                      </Link>
                      <Link
                        href={`/dashboard/projects/${project.slug}`}
                        className="font-mono text-[11.5px] text-ink-faint underline-offset-4 hover:underline"
                      >
                        details
                      </Link>
                      {project.previewUrl ? (
                        <a href={project.previewUrl} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-hood-deep underline underline-offset-4">
                          live
                        </a>
                      ) : (
                        <span className="font-mono text-[12px] text-ink-faint">not hosted yet</span>
                      )}
                      {testnet ? (
                        <a
                          href={testnetExplorer(testnet)}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[12px] text-ink-soft underline underline-offset-4"
                        >
                          {shortAddress(testnet)}
                        </a>
                      ) : null}
                      <Time at={project.createdAt} className="font-mono text-[11.5px] text-ink-faint" />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Account">
            <div className="flex flex-col gap-3 px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-ink-soft">Handle</span>
                <span className="text-[13px] font-medium text-ink">{session.user.name}</span>
              </div>
              {uniqueWallets.length === 0 ? (
                <p className="text-[13.5px] text-ink-soft">No wallet linked.</p>
              ) : (
                uniqueWallets.map(function renderWallet(wallet) {
                  return (
                    <div key={wallet.id} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-ink-soft">Wallet</span>
                      <span className="font-mono text-[12.5px] text-ink">{shortAddress(wallet.address)}</span>
                    </div>
                  );
                })
              )}
              <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
                <span className="text-[13px] text-ink-soft">Telegram</span>
                {telegramAccount ? (
                  <StatusChip tone="good">{telegramAccount.username ? `@${telegramAccount.username}` : "linked"}</StatusChip>
                ) : (
                  <Link href="/dashboard/settings" className="text-[13px] text-hood-deep underline underline-offset-4">
                    not linked
                  </Link>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-ink-soft">Member since</span>
                <Time at={session.user.createdAt} mode="absolute" className="text-[13px] text-ink" />
              </div>
            </div>
          </Panel>

          <div id="buy-credits">
            <Panel title="Credit options" description={treasuryAddress() ? `${PRICE_PER_CREDIT_USDG} USDG per credit, paid from your signed-in wallet.` : "Paid checkout is not open. Your own model API key is available in Settings; provider charges apply."}>
              <div className="px-5 py-4">
                <PayButton treasury={treasuryAddress()} priceUsdg={PRICE_PER_CREDIT_USDG} />
              </div>
            </Panel>
          </div>

          <Panel title="Credit history" description="Your balance is the sum of these rows.">
            {ledger.length === 0 ? (
              <p className="px-5 py-5 text-[13.5px] text-ink-soft">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-line">
                {ledger.map(function renderEvent(event) {
                  return (
                    <li key={event.id} className="flex items-center gap-3 px-5 py-2.5">
                      <span className="text-[13px] text-ink-soft">{REASON_LABEL[event.reason] ?? event.reason}</span>
                      <Time at={event.createdAt} className="ml-auto font-mono text-[11.5px] text-ink-faint" />
                      <span className={`w-10 text-right font-mono text-[12.5px] ${event.delta > 0 ? "text-hood-deep" : "text-ink"}`}>
                        {event.delta > 0 ? `+${event.delta}` : event.delta}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-6">
        <Panel title="Recent builds" description="Each build is one prompt through the agent, the compiler, and the tests.">
          {recentBuilds.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">No builds yet.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recentBuilds.map(function renderBuild(build) {
                return (
                  <li key={build.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <StatusChip tone={buildStatusTone(build.status)}>{build.status}</StatusChip>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink-soft">{build.prompt}</span>
                    {build.error ? <span className="w-full text-[12px] text-red-700 sm:w-auto sm:max-w-xs sm:truncate">{build.error}</span> : null}
                    <Time at={build.createdAt} className="font-mono text-[11.5px] text-ink-faint" />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
