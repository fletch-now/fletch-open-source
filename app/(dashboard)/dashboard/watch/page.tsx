import Link from "@/components/ui/navigation-link";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { WatcherList, type WatcherListItem } from "@/components/dashboard/watch/watcher-list";
import { listWatchersForUser } from "@/lib/watch/queries";
import { getAssets } from "@/lib/registry/assets";
import { getTelegramAccount } from "@/lib/telegram/link";
import { readHeartbeat, type HeartbeatRow } from "@/lib/watch/heartbeat";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { WATCH_LIMITS } from "@/lib/watch/types";
import { NoticeBar, PageHeader } from "@/components/dashboard/ui";

const HEARTBEAT_FRESH_SECONDS = 60;

function daemonLine(heartbeat: HeartbeatRow | null): { text: string; ok: boolean } {
  if (!heartbeat) {
    return { text: "worker heartbeat unavailable", ok: false };
  }
  const ageSeconds = Math.round((Date.now() - heartbeat.lastBeatAt.getTime()) / 1000);
  if (ageSeconds > HEARTBEAT_FRESH_SECONDS) {
    return { text: `worker heartbeat overdue, last seen ${ageSeconds}s ago`, ok: false };
  }
  const head = heartbeat.headBlock === null ? "" : ` · head block ${heartbeat.headBlock.toString()}`;
  return { text: `worker active${head}`, ok: true };
}

export default async function WatchPage(): Promise<React.ReactNode> {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Watchers are tied to a wallet"
        body="Connect a wallet to link Telegram and create watchers on Robinhood Chain assets."
      />
    );
  }

  const userId = session.user.id;
  const [rows, telegramAccount, heartbeat] = await Promise.all([
    listWatchersForUser(userId),
    getTelegramAccount(userId),
    readHeartbeat(),
  ]);

  const assetIds = Array.from(new Set(rows.map((row) => row.assetId).filter((id): id is string => id !== null)));
  const assets = await getAssets(assetIds);
  const symbolByAssetId = new Map<string, string>();
  for (const asset of assets) {
    symbolByAssetId.set(asset.id, asset.symbol);
  }

  const watchers: WatcherListItem[] = rows.map((row) => ({
    ...row,
    symbol: (row.assetId ? symbolByAssetId.get(row.assetId) : undefined) ?? row.address.slice(0, 6),
  }));

  const telegramWatchers = watchers.filter((watcher) => watcher.enabled && watcher.delivery === "telegram").length;
  const daemon = daemonLine(heartbeat);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Watch"
        description="Watch transfers, token changes and new pools after you close the tab. Matches are saved in your dashboard; Telegram and webhooks add notifications."
        actions={
          <Link
            href="/dashboard/watch/new"
            className="flex h-11 items-center rounded-full bg-hood px-5 text-[13px] font-semibold text-black transition-colors hover:bg-hood-strong"
          >
            New watcher
          </Link>
        }
      />

      {!daemon.ok ? (
        <NoticeBar tone="bad">
          {daemon.text}. Watchers resume from their last checkpoint when it returns. Matches may be delayed while sources catch up.
        </NoticeBar>
      ) : null}
      {!telegramAccount && telegramWatchers > 0 ? (
        <NoticeBar
          tone="neutral"
          action={
            <Link href="/dashboard/settings" className="text-[12.5px] underline underline-offset-4">
              Link Telegram
            </Link>
          }
        >
          {telegramWatchers} watcher{telegramWatchers === 1 ? " records" : "s record"} matches in your dashboard.
          Link Telegram to receive notifications there too.
        </NoticeBar>
      ) : null}

      <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${daemon.ok ? "bg-hood" : "bg-red-500"}`} />
          {daemon.text}
        </span>
        <span>· free during the beta, up to {WATCH_LIMITS.watchersPerUser} per account</span>
      </p>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard/alerts" className="inline-flex min-h-11 items-center text-[13px] text-hood-deep underline underline-offset-4">View all recorded matches</Link>
        <RefreshReading automatic />
      </div>
      <WatcherList watchers={watchers} />
    </div>
  );
}
