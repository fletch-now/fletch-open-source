import Link from "@/components/ui/navigation-link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/dal";
import { getBuildDetail, type BuildNeeds } from "@/lib/admin/queries";
import { PageHeader, Panel, StatusChip, Time, buildStatusTone } from "@/components/dashboard/ui";
import { formatDuration, shortId } from "@/components/admin/format";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import type { BuildEvent } from "@/lib/build/types";

const PHASE_TONE: Record<string, string> = {
  error: "text-red-700",
  compiling: "text-hood-deep",
  testing: "text-hood-deep",
  done: "text-hood-deep",
};

// Compact one-line summary of the structured parts of an event, so the log
// reads without expanding JSON: compile counts, test counts, artifact names.
function eventDetail(event: BuildEvent): string | null {
  if (event.compile) {
    const errors = event.compile.errors.length;
    return errors > 0 ? `${errors} compiler error${errors === 1 ? "" : "s"}` : `${event.compile.contracts.length} contract(s), solc ${event.compile.solc}`;
  }
  if (event.tests) {
    return `${event.tests.passed}/${event.tests.total} tests passed in ${event.tests.durationMs} ms`;
  }
  if (event.artifact) {
    return `artifact ${event.artifact.path}`;
  }
  return null;
}

// One build, end to end: who asked for what, what the agent and the toolchain
// reported, and what it cost. This is the page to open when a person says
// "my build failed" — the event log is the same stream their console saw.
function needsText(build: BuildNeeds): string {
  if (build.needsContract === null) {
    return "not analysed";
  }
  const shape = build.needsContract ? "contract" : "no contract";
  const wallet = build.needsWallet ? "wallet" : "no wallet";
  const source = build.needsSource === "model" ? "" : ` (${build.needsSource})`;
  const overridden = build.needsOverridden ? " · overridden by the agent" : "";
  return `${shape}, ${wallet}${source}${overridden}. ${build.needsReason ?? ""}`.trim();
}

export default async function AdminBuildPage({ params }: PageProps<"/trafalgar/builds/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const detail = await getBuildDetail(id);
  if (!detail) {
    notFound();
  }
  const { build, events, contracts, credits } = detail;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        breadcrumb={[
          { href: "/trafalgar", label: "Admin" },
          { href: "/trafalgar/builds", label: "Builds" },
        ]}
        title={`Build ${shortId(build.id)}`}
        description={build.prompt}
        actions={<StatusChip tone={buildStatusTone(build.status)}>{build.status}</StatusChip>}
      />

      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Panel title="Facts">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 px-5 py-4 text-[13px]">
            <dt className="text-ink-faint">account</dt>
            <dd>
              <Link href={`/trafalgar/users/${build.userId}`} className="text-ink hover:underline">
                {build.userName ?? shortId(build.userId)}
              </Link>
            </dd>
            <dt className="text-ink-faint">project</dt>
            <dd className="text-ink">{build.projectName ?? "—"}</dd>
            <dt className="text-ink-faint">model</dt>
            <dd className="font-mono text-[12px] text-ink">{build.model ?? build.provider}</dd>
            <dt className="text-ink-faint">needs</dt>
            <dd className="text-ink">{needsText(build)}</dd>
            <dt className="text-ink-faint">created</dt>
            <dd><Time at={build.createdAt} mode="absolute" className="font-mono text-[12px]" /></dd>
            <dt className="text-ink-faint">started</dt>
            <dd>{build.startedAt ? <Time at={build.startedAt} mode="absolute" className="font-mono text-[12px]" /> : "never"}</dd>
            <dt className="text-ink-faint">finished</dt>
            <dd>{build.finishedAt ? <Time at={build.finishedAt} mode="absolute" className="font-mono text-[12px]" /> : "—"}</dd>
            <dt className="text-ink-faint">duration</dt>
            <dd className="font-mono text-[12px]">{formatDuration(build.durationSeconds)}</dd>
            <dt className="text-ink-faint">id</dt>
            <dd className="break-all font-mono text-[11.5px] text-ink-soft">{build.id}</dd>
          </dl>
          {build.error ? (
            <p className="border-t border-line px-5 py-3 text-[13px] text-red-700">{build.error}</p>
          ) : null}
        </Panel>

        <Panel title="Credits" description="The ledger rows this build produced.">
          {credits.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-soft">None. A follow-up build on an existing project is free.</p>
          ) : (
            <ul className="divide-y divide-line">
              {credits.map(function renderEvent(event) {
                return (
                  <li key={event.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px]">
                    <span className="text-ink-soft">{event.reason}</span>
                    <Time at={event.createdAt} className="ml-auto font-mono text-[11.5px] text-ink-faint" />
                    <span className={`w-8 text-right font-mono ${event.delta > 0 ? "text-hood-deep" : "text-ink"}`}>
                      {event.delta > 0 ? `+${event.delta}` : event.delta}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="Contracts" description="Deployed from this build.">
          {contracts.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-ink-soft">None deployed. Deploy is not wired yet, so this is expected.</p>
          ) : (
            <ul className="divide-y divide-line">
              {contracts.map(function renderContract(contract) {
                return (
                  <li key={contract.id} className="px-5 py-2.5 text-[13px]">
                    <a
                      href={explorerAddressUrl(contract.chainId, contract.address)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-[12px] text-ink underline-offset-4 hover:underline"
                    >
                      {contract.address}
                    </a>
                    <span className="ml-2 mono-label !text-[10px]">chain {contract.chainId}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Event log" description={`${events.length} events, in order. This is the stream the person's console received.`}>
        {events.length === 0 ? (
          <p className="px-5 py-5 text-[13px] text-ink-soft">No events were persisted. The build never started, or it was swept before it wrote anything.</p>
        ) : (
          <ol className="divide-y divide-line font-mono text-[12px]">
            {events.map(function renderEvent(event, index) {
              const detailText = eventDetail(event);
              return (
                <li key={index} className="grid grid-cols-[3rem_6.5rem_1fr] gap-3 px-5 py-2">
                  <span className="text-ink-faint">{index + 1}</span>
                  <span className={PHASE_TONE[event.phase] ?? "text-ink-soft"}>{event.phase}</span>
                  <span className="min-w-0 whitespace-pre-wrap break-words text-ink">
                    {event.text}
                    {detailText ? <span className="block text-ink-faint">{detailText}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </div>
  );
}
