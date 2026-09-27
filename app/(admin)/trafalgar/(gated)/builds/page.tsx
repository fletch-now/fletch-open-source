import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { listBuilds, type ListBuildsOptions } from "@/lib/admin/queries";
import { EmptyState, PageHeader, StatusChip, Table, Time, buildStatusTone } from "@/components/dashboard/ui";
import { formatDuration, shortId } from "@/components/admin/format";

const FILTERS: { key: NonNullable<ListBuildsOptions["status"]>; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "succeeded", label: "Succeeded" },
  { key: "failed", label: "Failed" },
];

function pickFilter(raw: unknown): NonNullable<ListBuildsOptions["status"]> {
  const match = FILTERS.find((filter) => filter.key === raw);
  return match ? match.key : "all";
}

// Every build on the platform, newest first, with the one line that says why a
// failed one failed. A running build here is a container on the box right now.
export default async function AdminBuildsPage({ searchParams }: PageProps<"/trafalgar/builds">) {
  await requireAdmin();
  const params = await searchParams;
  const status = pickFilter(params.status);
  const builds = await listBuilds({ status, limit: 150 });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Builds"
        description="Each row is one prompt through the agent, the compiler, and the tests. Open a row for the full event log."
        actions={
          <nav className="flex items-center gap-1 rounded-full border border-line bg-raised p-1">
            {FILTERS.map(function renderFilter(filter) {
              const on = filter.key === status;
              return (
                <Link
                  key={filter.key}
                  href={filter.key === "all" ? "/trafalgar/builds" : `/trafalgar/builds?status=${filter.key}`}
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

      {builds.length === 0 ? (
        <EmptyState
          title={status === "all" ? "No builds yet" : `No ${status} builds`}
          body={status === "running" ? "Nothing is holding a sandbox right now." : "Builds appear here the moment a prompt is sent."}
        />
      ) : (
        <Table
          columns={[
            { key: "status", label: "status" },
            { key: "prompt", label: "prompt" },
            { key: "account", label: "account" },
            { key: "model", label: "model" },
            { key: "duration", label: "duration", align: "right" },
            { key: "when", label: "started", align: "right" },
          ]}
          rows={builds.map(function renderBuild(build) {
            return [
              <StatusChip key="s" tone={buildStatusTone(build.status)}>{build.status}</StatusChip>,
              <span key="p" className="block max-w-lg">
                <Link href={`/trafalgar/builds/${build.id}`} className="line-clamp-1 text-ink hover:underline">
                  {build.prompt}
                </Link>
                {build.error ? <span className="mt-0.5 line-clamp-1 text-[12px] text-red-700">{build.error}</span> : null}
              </span>,
              <Link key="u" href={`/trafalgar/users/${build.userId}`} className="text-ink-soft hover:underline">
                {build.userName ?? shortId(build.userId)}
              </Link>,
              <span key="m" className="font-mono text-[11.5px] text-ink-faint">{build.model ?? build.provider}</span>,
              <span key="d" className="font-mono text-[11.5px]">{formatDuration(build.durationSeconds)}</span>,
              <Time key="t" at={build.startedAt ?? build.createdAt} className="font-mono text-[11.5px] text-ink-faint" />,
            ];
          })}
        />
      )}
    </div>
  );
}
