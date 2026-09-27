import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { listDeliveries } from "@/lib/admin/queries";
import { retryDelivery } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { EmptyState, PageHeader, StatusChip, Table, Time, deliveryStatusTone } from "@/components/dashboard/ui";
import { shortId } from "@/components/admin/format";
import type { DeliveryStatus } from "@/lib/watch/types";
import { WATCH_LIMITS } from "@/lib/watch/types";

const FILTERS: { key: DeliveryStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "failed", label: "Failed" },
  { key: "retracted", label: "Retracted" },
];

function pickFilter(raw: unknown): DeliveryStatus | "all" {
  const match = FILTERS.find((filter) => filter.key === raw);
  return match ? match.key : "all";
}

// The outbox. One row per matched on-chain event per watcher; a row moves from
// pending to sent or, after WATCH_LIMITS.maxDeliveryAttempts, to failed with the
// last error kept. Retry puts a failed row back at the front of the queue.
export default async function AdminDeliveriesPage({ searchParams }: PageProps<"/trafalgar/deliveries">) {
  await requireAdmin();
  const params = await searchParams;
  const status = pickFilter(params.status);
  const deliveries = await listDeliveries(status, 150);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Deliveries"
        description={`Every alert the daemon has matched, newest first. A failed row gave up after ${WATCH_LIMITS.maxDeliveryAttempts} attempts; retry it once the cause is fixed.`}
        actions={
          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-raised p-1">
            {FILTERS.map(function renderFilter(filter) {
              const on = filter.key === status;
              return (
                <Link
                  key={filter.key}
                  href={filter.key === "all" ? "/trafalgar/deliveries" : `/trafalgar/deliveries?status=${filter.key}`}
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

      {deliveries.length === 0 ? (
        <EmptyState
          title={status === "all" ? "Nothing matched yet" : `No ${status} deliveries`}
          body="A row appears the moment a watcher's threshold is crossed on chain."
        />
      ) : (
        <Table
          columns={[
            { key: "status", label: "status" },
            { key: "event", label: "event" },
            { key: "watcher", label: "watcher" },
            { key: "owner", label: "owner" },
            { key: "attempts", label: "attempts", align: "right" },
            { key: "when", label: "matched", align: "right" },
            { key: "actions", label: "" },
          ]}
          rows={deliveries.map(function renderDelivery(delivery) {
            return [
              <StatusChip key="s" tone={deliveryStatusTone(delivery.status)}>{delivery.status}</StatusChip>,
              <span key="e" className="block">
                <span className="font-mono text-[12.5px] text-ink">
                  {delivery.amount ? Number(delivery.amount).toLocaleString(undefined, { maximumFractionDigits: 4 }) : "?"}{" "}
                  {delivery.symbol ?? ""}
                </span>
                {delivery.explorerUrl ? (
                  <a href={delivery.explorerUrl} target="_blank" rel="noreferrer" className="ml-2 font-mono text-[11px] text-hood-deep underline underline-offset-4">
                    tx
                  </a>
                ) : null}
                {delivery.lastError ? <span className="mt-0.5 line-clamp-1 text-[12px] text-red-700">{delivery.lastError}</span> : null}
              </span>,
              <span key="w" className="text-ink-soft">{delivery.watcherName ?? shortId(delivery.watcherId)}</span>,
              <Link key="o" href={`/trafalgar/users/${delivery.userId}`} className="text-ink-soft hover:underline">
                {delivery.userName ?? shortId(delivery.userId)}
              </Link>,
              <span key="a" className="font-mono text-[12px]">{delivery.attempts}</span>,
              <Time key="t" at={delivery.createdAt} className="font-mono text-[11.5px] text-ink-faint" />,
              delivery.status === "failed" ? (
                <ActionForm key="r" action={retryDelivery} fields={{ deliveryId: delivery.id }} label="Retry" />
              ) : (
                <span key="r" />
              ),
            ];
          })}
        />
      )}
    </div>
  );
}
