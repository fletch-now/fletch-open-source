import Link from "@/components/ui/navigation-link";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/dal";
import { GuestPanel } from "@/components/dashboard/guest-panel";
import { db } from "@/lib/db";
import { walletAddress } from "@/lib/db/schema";
import { listApiKeys } from "@/lib/auth/api-keys";
import { listModelKeys } from "@/lib/agent/user-keys";
import { ApiKeysCard } from "@/components/dashboard/settings/api-keys-card";
import { ModelKeyCard } from "@/components/dashboard/settings/model-key-card";
import { WebhooksCard } from "@/components/dashboard/settings/webhooks-card";
import { TelegramLinkCard } from "@/components/dashboard/watch/telegram-link-card";
import { TelegramBotCard } from "@/components/dashboard/settings/telegram-bot-card";
import { getUserBot } from "@/lib/telegram/bots";
import { getTelegramAccount } from "@/lib/telegram/link";
import { telegramConfigured } from "@/lib/telegram/client";
import { listWatchersForUser } from "@/lib/watch/queries";
import { listWebhookEndpoints } from "@/lib/watch/webhooks";
import { NoticeBar, PageHeader, Panel, StatusChip, Time } from "@/components/dashboard/ui";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { HolderRewardCard } from "@/components/holder-rewards/card";
import { FltxContract } from "@/components/fltx-contract";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default async function SettingsPage(): Promise<React.ReactNode> {
  const session = await getSession();
  if (!session) {
    return (
      <GuestPanel
        title="Settings are tied to a wallet"
        body="Connect a wallet to link Telegram for alerts, see your account, and manage API keys."
      />
    );
  }

  const userId = session.user.id;
  const [wallets, telegramAccount, apiKeys, watchers, ownBot, webhooks, modelKeys] = await Promise.all([
    db.select().from(walletAddress).where(eq(walletAddress.userId, userId)),
    getTelegramAccount(userId),
    listApiKeys(userId),
    listWatchersForUser(userId),
    getUserBot(userId),
    listWebhookEndpoints(userId),
    listModelKeys(userId),
  ]);
  const enabledWatchers = watchers.filter((watcher) => watcher.enabled).length;
  const telegramWatchers = watchers.filter((watcher) => watcher.enabled && watcher.delivery === "telegram").length;
  // SIWE stores one row per chain id the wallet signed on; the person has one wallet.
  const uniqueWallets = Array.from(new Map(wallets.map((wallet) => [wallet.address.toLowerCase(), wallet])).values());
  const configured = telegramConfigured();

  return (
    <div className="dashboard-settings min-w-0 w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader
        title="Settings"
        description="Manage notifications, your account and API access."
      />

      {!telegramAccount && telegramWatchers > 0 ? (
        <NoticeBar tone="neutral">
          {telegramWatchers} watcher{telegramWatchers === 1 ? " records" : "s record"} matches in your dashboard. Telegram is not linked. Connect it below for notifications too.
        </NoticeBar>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <HolderRewardCard />
        <section id="telegram" className="min-w-0 scroll-mt-6">
          <Panel title="Telegram notifications" description="Watchers record matches in your dashboard. Connect Telegram to receive them there too.">
            <div className="space-y-4 p-4 sm:p-5">
              <div className="flex flex-wrap items-center gap-3 text-[13px]">
                <TelegramMark size={16} />
                {telegramAccount ? <StatusChip tone="good">linked</StatusChip> : <StatusChip tone="neutral">optional</StatusChip>}
                <span className="text-ink-soft">{telegramWatchers} watcher{telegramWatchers === 1 ? "" : "s"} with Telegram selected</span>
              </div>
              {configured && !ownBot ? (
                <div>
                  <p className="mono-label mb-2">Fletch bot</p>
                  <TelegramLinkCard configured linked={Boolean(telegramAccount)} linkedUsername={telegramAccount?.username ?? null} />
                </div>
              ) : null}
              <details open={Boolean(ownBot) || !configured} className="rounded-lg border border-line p-3">
                <summary className="min-h-11 cursor-pointer content-center text-[14px] font-medium text-ink">Use your own Telegram bot</summary>
                <div className="pt-2">
              <TelegramBotCard
                bot={ownBot ? { username: ownBot.username, createdAt: ownBot.createdAt.toISOString() } : null}
                linkedUsername={telegramAccount?.username ?? null}
                linked={Boolean(ownBot && telegramAccount)}
              />
                </div>
              </details>
              <p className="text-[13px] leading-6 text-ink-faint">
                Your bot token is stored encrypted. Your first watcher can record dashboard activity before you connect a notification channel.
                Additional watchers require a linked Telegram chat or a webhook.{" "}
                <Link href="/dashboard/alerts" className="underline underline-offset-4 hover:text-ink">View recorded matches</Link>
              </p>
            </div>
          </Panel>
        </section>
        <section id="model-keys" className="min-w-0 scroll-mt-6">
          <Panel
            title="Use your own API key"
            description="Build with OpenAI, Anthropic or Kimi for 0 Fletch credits. Your provider bills API usage."
          >
            <ModelKeyCard
              keys={modelKeys.map(function shape(key) {
                return { id: key.id, validationStatus: key.validationStatus, provider: key.provider, model: key.model, custodyMode: key.custodyMode };
              })}
            />
          </Panel>
        </section>
        <section id="webhooks" className="min-w-0 scroll-mt-6"><WebhooksCard webhooks={webhooks} watchers={watchers.map(({ id, name, webhookId, enabled }) => ({ id, name, webhookId, enabled }))} /></section>
        <section id="api-keys" className="min-w-0 scroll-mt-6"><ApiKeysCard keys={apiKeys} /></section>
        <section id="account" className="min-w-0 scroll-mt-6">
          <Panel title="Account" description="A wallet signature is the account.">
            <dl className="divide-y divide-line">
              <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                <dt className="text-ink-faint">Handle</dt>
                <dd className="min-w-0 break-all text-right font-medium text-ink">{session.user.name}</dd>
              </div>
              {uniqueWallets.length === 0 ? (
                <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                  <dt className="text-ink-faint">Wallet</dt>
                  <dd className="text-ink-faint">none linked</dd>
                </div>
              ) : (
                uniqueWallets.map(function renderWallet(wallet) {
                  return (
                    <div key={wallet.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                      <dt className="text-ink-faint">Wallet</dt>
                      <dd className="font-mono text-[12.5px] text-ink" title={wallet.address}>
                        {shortAddress(wallet.address)}
                      </dd>
                    </div>
                  );
                })
              )}
              <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                <dt className="text-ink-faint">Joined</dt>
                <dd className="text-ink">
                  <Time at={session.user.createdAt} mode="absolute" />
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 px-5 py-3 text-[13.5px]">
                <dt className="text-ink-faint">Watchers</dt>
                <dd className="text-ink">
                  {enabledWatchers} enabled of {watchers.length}
                </dd>
              </div>
            </dl>
          </Panel>
        </section>
        <section id="api-guide" className="min-w-0 scroll-mt-6">
          <Panel title="Use the API" description="A key authenticates a request as a bearer token, with only the scopes it was created with.">
            <div className="flex flex-col gap-3 px-5 py-4">
              <pre className="overflow-x-auto rounded-md border border-line bg-panel/60 px-3 py-2.5 font-mono text-[12.5px] text-ink">
                {`curl -H "Authorization: Bearer flk_…" https://fletch.now/api/v1/chains/4663/assets`}
              </pre>
              <p className="text-[13px] leading-6 text-ink-soft">
                Live today: chains, the registry under <span className="font-mono">/chains/4663/assets</span>, your
                watchers and their runs, your projects, and your builds. Each key is limited to 600 requests an hour.
              </p>
              <p className="text-[13px] leading-6 text-ink-faint">
                The reference is{" "}
                <a href="/api/v1/openapi.json" className="underline underline-offset-4 hover:text-ink">
                  /api/v1/openapi.json
                </a>{" "}
                (OpenAPI 3.1). The{" "}
                <Link href="/docs/mcp" className="underline underline-offset-4 hover:text-ink">MCP setup guide</Link>{" "}
                covers the source-installed client and its read tools.
              </p>
            </div>
          </Panel>
        </section>
        <section id="fltx-contract" aria-label="$FLTX contract" className="min-w-0 lg:col-span-2"><FltxContract /></section>
      </div>
    </div>
  );
}
