import Link from "@/components/ui/navigation-link";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { DeliveryList } from "@/components/dashboard/watch/delivery-list";
import { getDeliveryStats, listDeliveriesForUser } from "@/lib/watch/queries";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { PageHeader } from "@/components/dashboard/ui";

const ALERTS_LIMIT = 100;

function formatWhen(date: Date | null): string {
  if (!date) {
    return "none yet";
  }
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default async function AlertsPage(): Promise<React.ReactNode> {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Alerts are tied to a wallet"
        body="Connect a wallet to see delivery history across your watchers."
      />
    );
  }

  const [deliveries, stats] = await Promise.all([
    listDeliveriesForUser(session.user.id, ALERTS_LIMIT),
    getDeliveryStats(session.user.id),
  ]);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Alerts"
        actions={<RefreshReading automatic />}
        description="Your latest 100 recorded matches, including those saved without Telegram. Sent means the notification service accepted delivery. Failed shows the reason; retracted marks an event withdrawn after a block reorganization."
      />

      <div className="mb-6 flex flex-wrap items-center gap-6 rounded-card border border-line bg-raised px-5 py-4">
        <div>
          <p className="mono-label">last 24h</p>
          <p className="mt-1 text-[20px] font-medium text-ink">{stats.last24h}</p>
        </div>
        <div className="h-8 w-px bg-line" aria-hidden="true" />
        <div>
          <p className="mono-label">failed</p>
          <p className={`mt-1 text-[20px] font-medium ${stats.failed24h > 0 ? "text-red-700" : "text-ink"}`}>
            {stats.failed24h}
          </p>
        </div>
        <div className="h-8 w-px bg-line" aria-hidden="true" />
        {stats.held > 0 ? (
          <>
            <div>
              <p className="mono-label">detected, not sent</p>
              <p className="mt-1 text-[14px] text-ink-soft">
                {stats.held} saved ·{" "}
                <Link href="/dashboard/settings#telegram" className="text-hood-deep underline underline-offset-4 hover:text-ink">
                  link Telegram
                </Link>
              </p>
            </div>
          </>
        ) : null}
        <div>
          <p className="mono-label">last sent</p>
          <p className="mt-1 text-[14px] text-ink-soft">{formatWhen(stats.lastSentAt)}</p>
        </div>
      </div>

      <DeliveryList
        deliveries={deliveries}
        showWatcherName
        emptyState={
          <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
            <p className="text-[15px] text-ink">No alerts yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
              Create a watcher to record matching transfers, token changes or new pools here.
            </p>
          </div>
        }
      />
    </div>
  );
}
