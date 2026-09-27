import Link from "@/components/ui/navigation-link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getUserDetail } from "@/lib/admin/queries";
import { adjustCredits, setUserBanned, setUserRole } from "@/lib/admin/actions";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader, Panel, Stat, StatGrid, StatusChip, Table, Time, buildStatusTone, watcherStatusTone } from "@/components/dashboard/ui";
import { formatDuration, shortAddress, shortId } from "@/components/admin/format";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain/explorer";
import { RH_MAINNET_ID } from "@/lib/config";

const REASON_LABEL: Record<string, string> = {
  free_grant: "Free grant",
  build_debit: "Build",
  refund: "Refund",
  admin_adjust: "Adjustment",
  purchase: "Purchase",
};

// One account, all of it: what it owns, what it has spent, and the three
// things an operator can change about it. Reads come from lib/admin/queries;
// every button is a server action that writes an audit row.
export default async function AdminUserPage({ params }: PageProps<"/trafalgar/users/[id]">) {
  const admin = await requireAdmin();
  const { id } = await params;
  const detail = await getUserDetail(id);
  if (!detail) {
    notFound();
  }
  const { user, wallets, ledger, builds, watchers, keys, telegram, abuse, audit } = detail;
  const isSelf = user.id === admin.userId;
  const isAdmin = user.role === "admin";

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb={[
          { href: "/trafalgar", label: "Admin" },
          { href: "/trafalgar/users", label: "Users" },
        ]}
        title={user.name ?? shortId(user.id)}
        description={`Joined ${user.createdAt.toISOString().slice(0, 10)} · id ${user.id}`}
        actions={
          <>
            {isAdmin ? <StatusChip tone="info">admin</StatusChip> : null}
            {user.banned ? <StatusChip tone="bad">banned</StatusChip> : null}
            {telegram ? <StatusChip tone="good">telegram linked</StatusChip> : <StatusChip tone="neutral">no telegram</StatusChip>}
          </>
        }
      />

      <div className="mb-6">
        <StatGrid>
          <Stat label="Credits" value={user.credits} hint="sum of the ledger below" tone={user.credits <= 0 ? "warn" : "neutral"} />
          <Stat label="Builds" value={user.buildCount} hint={`${user.projectCount} projects`} />
          <Stat label="Watchers" value={user.watcherCount} hint={`${watchers.filter((w) => w.enabled).length} enabled`} />
          <Stat label="API keys" value={keys.filter((key) => !key.revokedAt).length} hint={`${keys.length} ever created`} />
        </StatGrid>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Wallets" description="Every address that has signed in to this account.">
          {wallets.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">No wallet linked.</p>
          ) : (
            <ul className="divide-y divide-line">
              {wallets.map(function renderWallet(wallet) {
                return (
                  <li key={wallet.address} className="flex flex-wrap items-center gap-3 px-5 py-3">
                    <a
                      href={explorerAddressUrl(wallet.chainId, wallet.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[12.5px] text-ink underline-offset-4 hover:underline"
                    >
                      {wallet.address}
                    </a>
                    <span className="mono-label !text-[10px]">chain {wallet.chainId}</span>
                    <Time at={wallet.createdAt} className="ml-auto font-mono text-[11.5px] text-ink-faint" />
                  </li>
                );
              })}
            </ul>
          )}
          {abuse.length > 0 ? (
            <div className="border-t border-line px-5 py-3">
              <p className="mono-label mb-2">free-grant checks</p>
              <ul className="flex flex-col gap-1">
                {abuse.map(function renderSignal(signal) {
                  return (
                    <li key={signal.id} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                      <StatusChip tone={signal.verdict === "deny" ? "bad" : "good"}>{signal.verdict}</StatusChip>
                      <span className="text-ink-soft">
                        {signal.walletTxCount ?? 0} transactions on chain
                      </span>
                      <Time at={signal.createdAt} className="ml-auto font-mono text-[11.5px] text-ink-faint" />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Panel>

        <Panel title="Operator actions" description="Each one is recorded in the audit trail with your account on it.">
          <div className="flex flex-col gap-4 px-5 py-4">
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink">Adjust credits</p>
              <ActionForm action={adjustCredits} fields={{ userId: user.id }} label="Apply" tone="primary">
                <input
                  type="number"
                  name="delta"
                  required
                  min={-100}
                  max={100}
                  placeholder="+3"
                  className="h-9 w-20 rounded-md border border-line bg-paper px-2 font-mono text-[13px] text-ink focus:border-hood/60 focus:outline-none"
                />
                <input
                  type="text"
                  name="note"
                  placeholder="why (kept in the audit trail)"
                  maxLength={200}
                  className="h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
                />
              </ActionForm>
              <p className="mt-1.5 text-[12px] text-ink-faint">
                Appends a ledger row; nothing is overwritten. Negative numbers take credits away.
              </p>
            </div>

            <div className="border-t border-line pt-4">
              <p className="mb-2 text-[13px] font-medium text-ink">Role</p>
              {isAdmin ? (
                <ActionForm
                  action={setUserRole}
                  fields={{ userId: user.id, role: "user" }}
                  label="Remove admin"
                  tone="danger"
                  confirm={isSelf ? undefined : `Remove admin from ${user.name ?? user.id}?`}
                />
              ) : (
                <ActionForm
                  action={setUserRole}
                  fields={{ userId: user.id, role: "admin" }}
                  label="Make admin"
                  confirm={`Give ${user.name ?? user.id} full access to this console?`}
                />
              )}
            </div>

            <div className="border-t border-line pt-4">
              <p className="mb-2 text-[13px] font-medium text-ink">Access</p>
              {user.banned ? (
                <ActionForm action={setUserBanned} fields={{ userId: user.id, banned: "false" }} label="Lift ban" />
              ) : (
                <ActionForm
                  action={setUserBanned}
                  fields={{ userId: user.id, banned: "true" }}
                  label="Ban account"
                  tone="danger"
                  confirm={`Ban ${user.name ?? user.id}? They are signed out everywhere and their watchers pause.`}
                >
                  <input
                    type="text"
                    name="reason"
                    placeholder="reason"
                    maxLength={200}
                    className="h-9 min-w-0 flex-1 rounded-md border border-line bg-paper px-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
                  />
                </ActionForm>
              )}
            </div>
          </div>
        </Panel>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Ledger" description="Balance is the sum of these rows and nothing else.">
          {ledger.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">No credit events. A first build on a wallet with on-chain history grants the free credits.</p>
          ) : (
            <ul className="divide-y divide-line">
              {ledger.map(function renderEvent(event) {
                return (
                  <li key={event.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span className="text-ink-soft">{REASON_LABEL[event.reason] ?? event.reason}</span>
                    {event.buildId ? (
                      <Link href={`/trafalgar/builds/${event.buildId}`} className="font-mono text-[11.5px] text-ink-faint underline-offset-4 hover:underline">
                        {shortId(event.buildId)}
                      </Link>
                    ) : null}
                    {event.reason === "purchase" && event.externalRef ? (
                      <a href={explorerTxUrl(RH_MAINNET_ID, event.externalRef)} target="_blank" rel="noreferrer" className="font-mono text-[11.5px] text-hood-deep underline-offset-4 hover:underline">
                        tx {shortId(event.externalRef)}
                      </a>
                    ) : null}
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

        <Panel title="Watchers" description="Alerts this account keeps running on the daemon.">
          {watchers.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">None.</p>
          ) : (
            <ul className="divide-y divide-line">
              {watchers.map(function renderWatcher(watcher) {
                return (
                  <li key={watcher.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                    <StatusChip tone={watcherStatusTone(watcher.status)}>{watcher.status}</StatusChip>
                    <span className="font-medium text-ink">{watcher.name}</span>
                    <span className="font-mono text-[12px] text-ink-soft">
                      {watcher.symbol ?? shortAddress(watcher.address)} · {watcher.kind === "wallet_activity" ? "wallet" : `above ${watcher.threshold}`}
                    </span>
                    <span className="ml-auto font-mono text-[11.5px] text-ink-faint">
                      {watcher.deliveries} sent · {watcher.failedDeliveries} failed
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mb-6">
        <Panel title="Builds" description="Newest first. Open one for its event log.">
          {builds.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">No builds.</p>
          ) : (
            <Table
              dense
              flush
              columns={[
                { key: "status", label: "status" },
                { key: "prompt", label: "prompt" },
                { key: "project", label: "project" },
                { key: "duration", label: "duration", align: "right" },
                { key: "when", label: "when", align: "right" },
              ]}
              rows={builds.map(function renderBuild(build) {
                return [
                  <StatusChip key="s" tone={buildStatusTone(build.status)}>{build.status}</StatusChip>,
                  <Link key="p" href={`/trafalgar/builds/${build.id}`} className="line-clamp-1 max-w-md text-ink hover:underline">
                    {build.prompt}
                  </Link>,
                  <span key="pr" className="text-ink-soft">{build.projectName ?? "—"}</span>,
                  <span key="d" className="font-mono text-[11.5px]">{formatDuration(build.durationSeconds)}</span>,
                  <Time key="t" at={build.createdAt} className="font-mono text-[11.5px] text-ink-faint" />,
                ];
              })}
            />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="API keys" description="Only the prefix is stored in the clear.">
          {keys.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">None.</p>
          ) : (
            <ul className="divide-y divide-line">
              {keys.map(function renderKey(key) {
                return (
                  <li key={key.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-[13px]">
                    <span className="font-medium text-ink">{key.name}</span>
                    <span className="font-mono text-[12px] text-ink-soft">{key.prefix}…</span>
                    <span className="font-mono text-[11px] text-ink-faint">{key.scopes.join(" ")}</span>
                    {key.revokedAt ? <StatusChip tone="neutral">revoked</StatusChip> : null}
                    <span className="ml-auto font-mono text-[11.5px] text-ink-faint">
                      {key.lastUsedAt ? "used " : "never used"}
                      {key.lastUsedAt ? <Time at={key.lastUsedAt} /> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Audit trail for this account" description="Their own actions and anything an operator did to them.">
          {audit.length === 0 ? (
            <p className="px-5 py-5 text-[13.5px] text-ink-soft">Nothing recorded.</p>
          ) : (
            <ul className="divide-y divide-line">
              {audit.map(function renderEntry(entry) {
                return (
                  <li key={entry.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[12.5px]">
                    <span className="font-mono text-ink">{entry.action}</span>
                    {entry.resourceId ? <span className="font-mono text-[11.5px] text-ink-faint">{shortId(entry.resourceId)}</span> : null}
                    <Time at={entry.createdAt} className="ml-auto font-mono text-[11.5px] text-ink-faint" />
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
