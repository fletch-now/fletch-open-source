import Link from "@/components/ui/navigation-link";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { WatcherForm } from "@/components/dashboard/watch/watcher-form";
import { listAssets } from "@/lib/registry/assets";
import { getTelegramAccount } from "@/lib/telegram/link";
import { listWebhookEndpoints } from "@/lib/watch/webhooks";
import { RH_MAINNET_ID } from "@/lib/config";
import { isWatcherKind, type WatcherKind } from "@/lib/watch/types";

export default async function NewWatcherPage({ searchParams }: PageProps<"/dashboard/watch/new">): Promise<React.ReactNode> {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Watchers are tied to a wallet"
        body="Connect a wallet to create a watcher on a Robinhood Chain asset."
      />
    );
  }

  const params = await searchParams;
  const rawKind = typeof params.kind === "string" ? params.kind : undefined;
  const initialKind: WatcherKind | undefined = rawKind && isWatcherKind(rawKind) ? rawKind : undefined;
  const initialAssetId = typeof params.asset === "string" ? params.asset : undefined;
  const initialThreshold = typeof params.threshold === "string" ? params.threshold : undefined;
  const initialWallet = typeof params.wallet === "string" ? params.wallet : undefined;
  const initialProjectId = typeof params.project === "string" ? params.project : undefined;
  const initialAddress = typeof params.address === "string" ? params.address : undefined;

  const [assets, telegramAccount, webhooks] = await Promise.all([
    listAssets(RH_MAINNET_ID),
    getTelegramAccount(session.user.id),
    listWebhookEndpoints(session.user.id),
  ]);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <Link href="/dashboard/watch" className="text-[13px] text-ink-faint transition-colors hover:text-ink">
          ← Watch
        </Link>
        <h1 className="display mt-2 text-[26px] text-ink">New watcher</h1>
        <p className="mt-1 text-[14px] text-ink-soft">
          Choose transfers, token changes, new pools or Robinhood app changes. Matches are saved in your dashboard, with optional notifications.
        </p>
      </div>

      <WatcherForm
        assets={assets}
        telegramLinked={telegramAccount !== null}
        webhooks={webhooks.filter((webhook) => webhook.enabled).map((webhook) => ({ id: webhook.id, name: webhook.name }))}
        initialWebhookId={typeof params.webhook === "string" ? params.webhook : undefined}
        initialKind={initialKind}
        initialAssetId={initialAssetId}
        initialThreshold={initialThreshold}
        initialWallet={initialWallet}
        initialProjectId={initialProjectId}
        initialAddress={initialAddress}
      />
    </div>
  );
}
