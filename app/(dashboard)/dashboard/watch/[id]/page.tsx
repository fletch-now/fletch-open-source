import Link from "@/components/ui/navigation-link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { db } from "@/lib/db";
import { watchers } from "@/lib/db/schema";
import { getAsset } from "@/lib/registry/assets";
import { listDeliveriesForWatcher } from "@/lib/watch/queries";
import { readHeartbeat } from "@/lib/watch/heartbeat";
import { listWebhookEndpoints } from "@/lib/watch/webhooks";
import { deliveryTargetLabel } from "@/lib/watch/format";
import { WATCH_LIMITS, type WatcherKind } from "@/lib/watch/types";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { StatusBadge, statusMeaning } from "@/components/dashboard/watch/status-badge";
import { DeliveryList } from "@/components/dashboard/watch/delivery-list";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { WatcherNotifications } from "@/components/dashboard/watch/watcher-notifications";
import { WatcherActions } from "@/components/dashboard/watch/watcher-actions";

const DELIVERY_LIMIT = 100;

function shortHash(hash: string | null): string {
  if (!hash) {
    return "";
  }
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

const KIND_BADGE: Partial<Record<WatcherKind, string>> = {
  wallet_activity: "wallet activity",
  token_event: "token events",
  registry_event: "registry events",
  new_pool: "new pools",
  listing_event: "Robinhood app changes",
};

function targetLine(kind: WatcherKind, threshold: string, symbol: string): string {
  switch (kind) {
    case "listing_event":
      return "Catalog appearances, removals and Robinhood app status changes observed by Fletch";
    case "registry_event":
      return "every registry pause, upgrade, block, listing and chain status change";
    case "token_event":
      return `every pause, halt, multiplier change, stale feed and supply residual on ${symbol}`;
    case "new_pool":
      return "New pools as the registry records them";
    default:
      return `above ${threshold} ${symbol}`;
  }
}

export default async function WatcherDetailPage({ params }: PageProps<"/dashboard/watch/[id]">): Promise<React.ReactNode> {
  const session = await getSession();
  if (!session) {
    notFound();
  }
  const { id } = await params;

  // Scoped to the owner: a valid id from another account must 404, not leak
  // (same pattern as app/(dashboard)/dashboard/projects/[slug]/page.tsx). Queried
  // directly rather than through getWatcherForUser so the page can also read
  // lastCheckedBlockHash, which that read path doesn't carry.
  const rows = await db
    .select()
    .from(watchers)
    .where(and(eq(watchers.id, id), eq(watchers.userId, session.user.id)))
    .limit(1);
  const watcher = rows[0];
  if (!watcher) {
    notFound();
  }

  const [asset, deliveries, heartbeat, webhooks] = await Promise.all([
    watcher.assetId ? getAsset(watcher.assetId) : Promise.resolve(null),
    listDeliveriesForWatcher(session.user.id, watcher.id, DELIVERY_LIMIT),
    readHeartbeat(),
    listWebhookEndpoints(session.user.id),
  ]);

  const webhook = webhooks.find((endpoint) => endpoint.id === watcher.webhookId);
  const symbol = asset?.symbol ?? `${watcher.address.slice(0, 6)}…`;
  const transfers = watcher.kind === "large_transfer" || watcher.kind === "wallet_activity";
  const tokenTarget = transfers || watcher.kind === "token_event";
  const headBlock = heartbeat?.headBlock ?? null;
  const blockLag = headBlock !== null && watcher.lastCheckedBlock !== null ? headBlock - watcher.lastCheckedBlock : null;
  const pollSeconds = Math.round(WATCH_LIMITS.pollIntervalMs / 1000);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/dashboard/watch" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
        ← Watch
      </Link>

      <div className="mb-8 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display truncate text-[26px] text-ink">{watcher.name}</h1>
            <StatusBadge status={watcher.status} />
            {KIND_BADGE[watcher.kind] ? (
              <span className="rounded-full bg-panel px-2 py-0.5 text-[11px] font-medium text-ink-faint">{KIND_BADGE[watcher.kind]}</span>
            ) : null}
          </div>
          <p className="mt-1 text-[13px] text-ink-soft">{statusMeaning(watcher.status)}</p>

          {tokenTarget ? <p className="mt-3 break-all font-mono text-[12.5px] text-ink-faint">
            {symbol} ·{" "}
            <a
              href={explorerAddressUrl(watcher.chainId, watcher.address)}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4 transition-colors hover:text-ink"
            >
              {watcher.address}
            </a>
          </p> : null}
          {watcher.kind === "wallet_activity" && watcher.wallet ? (
            <p className="mt-1 break-all font-mono text-[12.5px] text-ink-soft">
              watching{" "}
              <a
                href={explorerAddressUrl(watcher.chainId, watcher.wallet)}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4 transition-colors hover:text-ink"
              >
                {watcher.wallet}
              </a>
              {Number(watcher.threshold) > 0 ? ` · min ${watcher.threshold} ${symbol}` : " · every transfer"}
            </p>
          ) : (
            <p className="mt-1 font-mono text-[12.5px] text-ink-soft">{targetLine(watcher.kind, watcher.threshold, symbol)}</p>
          )}

          <p className="mt-2 text-[12.5px] text-ink-faint">
            Dashboard history · notifications via {deliveryTargetLabel(watcher.delivery, webhook?.name ?? null)}
          </p>
          {transfers ? <p className="mt-1 text-[12.5px] text-ink-faint">
            {watcher.lastCheckedBlock === null
              ? "Waiting for the first block scan"
              : `checkpoint: block ${watcher.lastCheckedBlock.toString()} · ${shortHash(watcher.lastCheckedBlockHash)}`}
          </p> : null}
          {watcher.lastError ? <p className="mt-1 text-[12.5px] text-red-600">{watcher.lastError}</p> : null}
        </div>

        <WatcherActions watcherId={watcher.id} watcherName={watcher.name} enabled={watcher.enabled} />
      </div>

      <WatcherNotifications key={`${watcher.delivery}:${watcher.webhookId}`} watcherId={watcher.id} delivery={watcher.delivery} webhookId={watcher.webhookId} webhooks={webhooks.map(({ id, name, enabled }) => ({ id, name, enabled }))} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="text-[13px] text-ink-faint">Latest {DELIVERY_LIMIT} recorded matches</p><RefreshReading automatic /></div>
      <DeliveryList
        deliveries={deliveries}
        emptyState={
          <div className="rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
            <p className="text-[15px] text-ink">No matching events recorded yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-[14px] leading-6 text-ink-soft">
              Fletch checks for matches every {pollSeconds}s. Source updates may arrive later
              {transfers && blockLag !== null ? ` · currently ${blockLag.toString()} blocks behind head` : ""}.
            </p>
          </div>
        }
      />
    </div>
  );
}
