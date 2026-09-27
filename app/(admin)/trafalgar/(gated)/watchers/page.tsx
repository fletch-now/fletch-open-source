import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { listWatchers, type ListWatchersOptions } from "@/lib/admin/queries";
import { readHeartbeat } from "@/lib/watch/heartbeat";
import { setWatcherEnabledAsAdmin } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { EmptyState, PageHeader, StatusChip, Table, Time, watcherStatusTone } from "@/components/dashboard/ui";
import { shortAddress, shortId } from "@/components/admin/format";
import { WATCH_LIMITS } from "@/lib/watch/types";

const FILTERS: { key: NonNullable<ListWatchersOptions["status"]>; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "catching_up", label: "Catching up" },
  { key: "degraded", label: "Degraded" },
  { key: "paused", label: "Paused" },
];

function pickFilter(raw: unknown): NonNullable<ListWatchersOptions["status"]> {
  const match = FILTERS.find((filter) => filter.key === raw);
  return match ? match.key : "all";
}

function lagText(lastChecked: string | null, head: bigint | null): string {
  if (lastChecked === null || head === null) {
    return "—";
  }
  const lag = head - BigInt(lastChecked);
  if (lag <= BigInt(0)) {
    return "at head";
  }
  return `${lag.toString()} behind`;
}

// Every watcher on the daemon, across every account. Lag is the distance
// between the watcher's checkpoint and the chain head the daemon last saw; past
// WATCH_LIMITS.catchingUpBlocks it stops being "active".
export default async function AdminWatchersPage({ searchParams }: PageProps<"/trafalgar/watchers">) {
  await requireAdmin();
  const params = await searchParams;
  const status = pickFilter(params.status);
  const [watchers, heartbeat] = await Promise.all([listWatchers({ status }), readHeartbeat()]);
  const head = heartbeat?.headBlock ?? null;
  const enabled = watchers.filter((watcher) => watcher.enabled).length;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Watchers"
        description={`${enabled} enabled of a platform cap of ${WATCH_LIMITS.watchersPlatform}; each account may hold ${WATCH_LIMITS.watchersPerUser}. Pausing one here is recorded against your account.`}
        actions={
          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-raised p-1">
            {FILTERS.map(function renderFilter(filter) {
              const on = filter.key === status;
              return (
                <Link
                  key={filter.key}
                  href={filter.key === "all" ? "/trafalgar/watchers" : `/trafalgar/watchers?status=${filter.key}`}
                  className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
                    on ? "bg-ink text-paper" : "text-ink-soft hover:bg-panel hover:text-ink"
                  }`}
                >
                  {filter.label}
                </Link>
              );
            })}
          </nav>
        }
      />

      {watchers.length === 0 ? (
        <EmptyState title="No watchers match" body="Watchers are created from the dashboard or the v1 API." />
      ) : (
        <Table
          columns={[
            { key: "status", label: "status" },
            { key: "name", label: "watcher" },
            { key: "owner", label: "owner" },
            { key: "target", label: "watching" },
            { key: "lag", label: "checkpoint", align: "right" },
            { key: "sent", label: "alerts", align: "right" },
            { key: "last", label: "last alert", align: "right" },
            { key: "actions", label: "" },
          ]}
          rows={watchers.map(function renderWatcher(watcher) {
            const targetText =
              watcher.kind === "wallet_activity" && watcher.wallet
                ? `${watcher.symbol ?? shortAddress(watcher.address)} · wallet ${shortAddress(watcher.wallet)}`
                : `${watcher.symbol ?? shortAddress(watcher.address)} · above ${watcher.threshold}`;
            return [
              <StatusChip key="s" tone={watcherStatusTone(watcher.status)}>{watcher.status.replace("_", " ")}</StatusChip>,
              <span key="n" className="block">
                <span className="font-medium text-ink">{watcher.name}</span>
                {watcher.lastError ? <span className="mt-0.5 line-clamp-1 text-[12px] text-red-700">{watcher.lastError}</span> : null}
              </span>,
              <Link key="o" href={`/trafalgar/users/${watcher.userId}`} className="text-ink-soft hover:underline">
                {watcher.userName ?? shortId(watcher.userId)}
              </Link>,
              <span key="t" className="font-mono text-[12px] text-ink-soft">{targetText}</span>,
              <span key="l" className="font-mono text-[11.5px] text-ink-faint">{lagText(watcher.lastCheckedBlock, head)}</span>,
              <span key="c" className="font-mono text-[12px]">
                {watcher.deliveries}
                {watcher.failedDeliveries > 0 ? <span className="text-red-700"> · {watcher.failedDeliveries} failed</span> : null}
              </span>,
              watcher.lastTriggeredAt ? (
                <Time key="lt" at={watcher.lastTriggeredAt} className="font-mono text-[11.5px] text-ink-faint" />
              ) : (
                <span key="lt" className="text-ink-faint">none</span>
              ),
              <ActionForm
                key="a"
                action={setWatcherEnabledAsAdmin}
                fields={{ watcherId: watcher.id, enabled: watcher.enabled ? "false" : "true" }}
                label={watcher.enabled ? "Pause" : "Resume"}
                tone={watcher.enabled ? "danger" : "neutral"}
              />,
            ];
          })}
        />
      )}
    </div>
  );
}
