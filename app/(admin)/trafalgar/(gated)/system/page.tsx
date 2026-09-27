import { requireAdmin } from "@/lib/dal";
import { systemStatus } from "@/lib/admin/queries";
import { reapNow, setProviderIntegration } from "@/lib/admin/actions";
import { ActionForm, SimpleAction } from "@/components/admin/action-form";
import { NoticeBar, PageHeader, Panel, StatusChip, Time } from "@/components/dashboard/ui";
import { ageSeconds, formatAge, formatBytes } from "@/components/admin/format";
import Link from "@/components/ui/navigation-link";
import { RH_MAINNET_ID } from "@/lib/config";
import { registryVerdict } from "@/lib/registry/authority/freshness";
import { providerIntegrations } from "@/lib/admin/provider-integrations";
import { WATCH_LIMITS } from "@/lib/watch/types";
import { BuildCapacityPanel } from "@/components/admin/build-capacity";

const HEARTBEAT_FRESH_SECONDS = 60;

interface RowProps {
  label: string;
  value: React.ReactNode;
  note?: string;
}

function Row({ label, value, note }: RowProps) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 px-5 py-2.5 text-[13px]">
      <span className="w-44 shrink-0 text-ink-faint">{label}</span>
      <span className="font-mono text-[12.5px] text-ink">{value}</span>
      {note ? <span className="w-full text-[12px] text-ink-faint sm:w-auto sm:flex-1">{note}</span> : null}
    </div>
  );
}

// The machine behind the product: is the daemon alive, what is each build
// allowed to use, which ceilings are close, how much disk the workspaces hold,
// and which secrets are set. Values of secrets never reach this page; only
// whether they exist.
export default async function AdminSystemPage() {
  await requireAdmin();
  const [system, registry, integrations] = await Promise.all([systemStatus(), registryVerdict(RH_MAINNET_ID), providerIntegrations()]);
  const beatAge = ageSeconds(system.heartbeat?.lastBeatAt ?? null);
  const daemonDown = beatAge === null || beatAge > HEARTBEAT_FRESH_SECONDS;
  const registryDown = registry.verdict === "stale" || registry.verdict === "never";
  const detail = (system.heartbeat?.detail ?? {}) as Record<string, { ok: boolean; headBlock?: string; error?: string }>;
  const missingEnv = system.env.filter((entry) => !entry.set);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="System"
        description="The daemon, the sandbox, the ceilings, the disk, and the configuration, read live from the running process."
        actions={<SimpleAction action={reapNow} label="Reap now" />}
      />

      {daemonDown ? (
        <NoticeBar tone="bad">
          The Watch daemon is not reporting. On the box: <code className="font-mono">systemctl status fletch-watch</code>, then{" "}
          <code className="font-mono">journalctl -u fletch-watch -n 100</code>.
        </NoticeBar>
      ) : null}
      {registryDown ? (
        <NoticeBar tone="bad">
          The registry daemon is {registry.verdict}: {registry.summary} On the box: <code className="font-mono">systemctl status fletch-registry</code>, then{" "}
          <code className="font-mono">fletch-ops registry</code>.
        </NoticeBar>
      ) : registry.verdict === "degraded" ? (
        <NoticeBar tone="warn">
          The registry daemon is degraded: {registry.summary}{" "}
          <Link href="/trafalgar/registry" className="underline underline-offset-4">
            See which job.
          </Link>
        </NoticeBar>
      ) : null}
      {missingEnv.length > 0 ? (
        <NoticeBar tone="warn">
          Not set: {missingEnv.map((entry) => entry.name).join(", ")}. Each one turns a feature off; the list below says which.
        </NoticeBar>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="$FLTX holder credits" description="Configure the official token, reward period and automatic 10-credit grants.">
          <Link href="/trafalgar/holder-credits" className="inline-flex min-h-11 items-center px-5 text-sm underline underline-offset-4">Manage holder-credit policy</Link>
        </Panel>
        <BuildCapacityPanel />
        <Panel
          title="Registry daemon"
          description="fletch-registry.service runs the authority jobs; the verdict is the one /registry/status publishes."
          actions={
            <Link href="/trafalgar/registry" className="text-[12.5px] text-ink-soft underline underline-offset-4 hover:text-ink">
              every job
            </Link>
          }
        >
          <div className="divide-y divide-line">
            <Row label="verdict" value={<StatusChip tone={registryDown ? "bad" : registry.verdict === "degraded" ? "warn" : "good"}>{registry.verdict}</StatusChip>} note={registry.summary} />
            <Row label="read at" value={<Time at={registry.checkedAt} />} note="Read from sync_runs and daemon_heartbeats when this page was rendered." />
          </div>
        </Panel>

        <Panel title="Watch daemon" description="fletch-watch.service writes a heartbeat after every poll loop.">
          <div className="divide-y divide-line">
            <Row
              label="heartbeat"
              value={
                system.heartbeat ? (
                  <>
                    <StatusChip tone={daemonDown ? "bad" : "good"}>{daemonDown ? "stale" : "fresh"}</StatusChip>{" "}
                    <Time at={system.heartbeat.lastBeatAt} /> ({formatAge(beatAge)})
                  </>
                ) : (
                  <StatusChip tone="bad">never</StatusChip>
                )
              }
              note={`Red past ${HEARTBEAT_FRESH_SECONDS}s. Polls every ${Math.round(WATCH_LIMITS.pollIntervalMs / 1000)}s.`}
            />
            <Row label="head block" value={system.heartbeat?.headBlock?.toString() ?? "—"} note="Highest sequencer-confirmed block the daemon has seen." />
            {Object.entries(detail).map(function renderChain([chainId, info]) {
              return (
                <Row
                  key={chainId}
                  label={`chain ${chainId}`}
                  value={info.ok ? `ok · head ${info.headBlock ?? "—"}` : <span className="text-red-700">{info.error ?? "error"}</span>}
                />
              );
            })}
            {system.rpc.map(function renderRpc(rpc) {
              return (
                <Row
                  key={rpc.chainId}
                  label={`RPC ${rpc.chainId}`}
                  value={rpc.configured ? <StatusChip tone="good">configured endpoint</StatusChip> : <StatusChip tone="warn">public fallback</StatusChip>}
                  note={rpc.chainId === RH_MAINNET_ID && !rpc.configured ? "Set RPC_URL_4663 to an Alchemy or similar endpoint." : undefined}
                />
              );
            })}
            <Row
              label="Telegram bot"
              value={system.telegramConfigured ? <StatusChip tone="good">configured</StatusChip> : <StatusChip tone="warn">not configured</StatusChip>}
              note={system.telegramConfigured ? undefined : "The one-click Fletch bot is off until TELEGRAM_BOT_TOKEN, _USERNAME and _WEBHOOK_SECRET are set. People can still link their own bot from Settings."}
            />
          </div>
        </Panel>

        <Panel title="Builder" description="What one build may use. Every value is a container flag in lib/agent/sandbox.ts.">
          <div className="divide-y divide-line">
            <Row
              label="model"
              value={system.provider ? system.provider.model : <StatusChip tone="bad">no key</StatusChip>}
              note={system.provider ? system.provider.baseUrl : "MOONSHOT_API_KEY is empty; builds fail cleanly and refund."}
            />
            <Row label="runtime" value={system.sandbox.agent} note="cli = the agent runs as a real CLI with tools inside the container." />
            <Row
              label="sandbox image"
              value={system.sandbox.image ?? <StatusChip tone="bad">none</StatusChip>}
              note="cap-drop ALL, read-only root, tmpfs /tmp, no network for compile and test."
            />
            <Row label="per build" value={`${system.sandbox.cpus} CPU · ${system.sandbox.memory} RAM · 256 PIDs`} />
            <Row label="concurrent builds" value={system.sandbox.maxConcurrent} note="Shared queue limit; resource eligibility is shown above." />
            <Row label="agent turn timeout" value={`${Math.round(system.sandbox.timeoutMs / 1000)}s`} />
            <Row label="repair rounds" value={system.sandbox.repairRounds} note="Compiler errors sent back to the agent before the build fails." />
          </div>
        </Panel>

        <Panel title="Model connections" description="Provider controls apply to platform and own-key builds. Pausing blocks subsequent model requests, including active leases.">
          <div className="divide-y divide-line">
            {integrations.map((integration) => <div key={integration.provider} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div><p className="text-sm font-medium text-ink">{integration.provider}</p><p className="text-xs text-ink-faint">{integration.connected} hosted connections · {integration.validated} validated · {integration.gateways} gateways ({integration.onlineGateways} online)</p></div>
              <StatusChip tone={integration.enabled ? "good" : "warn"}>{integration.enabled ? "enabled" : "paused"}</StatusChip>
              <ActionForm action={setProviderIntegration} fields={{ provider: integration.provider, enabled: integration.enabled ? "0" : "1" }} label={integration.enabled ? "Pause integration" : "Enable integration"} />
            </div>)}
            <Row label="Hosted key custody" value="Encrypted at rest" note="Admin views contain connection metadata. Server operators can technically decrypt hosted keys." />
            <Row label="Credential encryption" value={process.env.MODEL_CREDENTIAL_KEY ? "dedicated key configured" : "new hosted connections unavailable"} note="MODEL_CREDENTIAL_KEY encrypts new hosted credentials; existing encrypted credentials retain their legacy read path." />
          </div>
        </Panel>

        <Panel title="Ceilings" description="Where a runaway stops. Counters live in Postgres and survive restarts.">
          <div className="divide-y divide-line">
            <Row label="builds per account" value={`${system.limits.buildsPerUserHour} / hour`} note="Plus one build at a time per account." />
            <Row label="builds per IP" value={`${system.limits.buildsPerIpHour} / hour`} />
            <Row label="builds platform-wide" value={`${system.limits.buildsGlobalDay} / day`} note="Past this every new build gets a waitlist message." />
            <Row label="watchers per account" value={system.limits.watchersPerUser} note="Beyond the first, Telegram must be linked." />
            <Row label="watchers platform-wide" value={system.limits.watchersPlatform} />
            <Row label="RPC calls" value={`${system.limits.rpcCallsPerDay.toLocaleString()} / day`} note="Shared by every watcher; the daemon pauses polling when it is reached." />
            <Row label="API key requests" value="600 / hour per key" />
          </div>
          {system.counters.length > 0 ? (
            <div className="border-t border-line px-5 py-3">
              <p className="mono-label mb-2">busiest counters, last 24h</p>
              <ul className="flex flex-col gap-1 font-mono text-[11.5px]">
                {system.counters.slice(0, 12).map(function renderCounter(counter) {
                  return (
                    <li key={counter.bucket} className="flex items-center gap-3">
                      <span className="text-ink-soft">{counter.bucket}</span>
                      <span className="ml-auto text-ink">{counter.count}</span>
                      <Time at={counter.windowStart} className="w-16 text-right text-ink-faint" />
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </Panel>

        <Panel title="Disk and configuration" description="Workspaces hold each project's files for follow-up prompts; the reaper removes any untouched for 14 days.">
          <div className="divide-y divide-line">
            <Row label="workspace root" value={system.workspaces.root} />
            <Row label="workspaces" value={`${system.workspaces.directories} · ${formatBytes(system.workspaces.bytes)}`} />
            <Row
              label="oldest"
              value={system.workspaces.oldestMtime ? <Time at={system.workspaces.oldestMtime} /> : "—"}
              note="Reap now fails builds stuck past 35 minutes and sweeps old workspaces; fletch-reap.timer does the same every 15 minutes."
            />
          </div>
          <div className="border-t border-line px-5 py-3">
            <p className="mono-label mb-2">environment</p>
            <ul className="grid gap-1 font-mono text-[11.5px] sm:grid-cols-2">
              {system.env.map(function renderEnv(entry) {
                return (
                  <li key={entry.name} className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.set ? "bg-hood" : "bg-red-500"}`} aria-hidden="true" />
                    <span className={entry.set ? "text-ink" : "text-red-700"}>{entry.name}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </div>
    </div>
  );
}
