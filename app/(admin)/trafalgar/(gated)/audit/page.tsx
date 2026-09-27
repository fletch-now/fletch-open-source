import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { listAudit } from "@/lib/admin/queries";
import { EmptyState, PageHeader, Table, Time } from "@/components/dashboard/ui";
import { shortId } from "@/components/admin/format";

const PREFIXES = [
  { key: "", label: "All" },
  { key: "admin.", label: "Operator" },
  { key: "watcher.", label: "Watchers" },
  { key: "key.", label: "API keys" },
  { key: "telegram.", label: "Telegram" },
];

// The append-only record of who changed what. Reads never land here; every
// write to a watcher, key, credit, role or ban does, with the actor attached.
export default async function AdminAuditPage({ searchParams }: PageProps<"/trafalgar/audit">) {
  await requireAdmin();
  const params = await searchParams;
  const action = typeof params.action === "string" ? params.action : "";
  const entries = await listAudit({ action: action || undefined, limit: 200 });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Audit trail"
        description="Sensitive changes, newest first: who did it, to what, and any detail the action recorded. Nothing here can be edited."
        actions={
          <nav className="flex flex-wrap items-center gap-1 rounded-full border border-line bg-raised p-1">
            {PREFIXES.map(function renderPrefix(prefix) {
              const on = prefix.key === action;
              return (
                <Link
                  key={prefix.key || "all"}
                  href={prefix.key ? `/trafalgar/audit?action=${encodeURIComponent(prefix.key)}` : "/trafalgar/audit"}
                  className={`rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors ${
                    on ? "bg-ink text-paper" : "text-ink-soft hover:bg-panel hover:text-ink"
                  }`}
                >
                  {prefix.label}
                </Link>
              );
            })}
          </nav>
        }
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded" body="Entries appear as soon as someone creates a watcher, a key, or an operator acts." />
      ) : (
        <Table
          dense
          columns={[
            { key: "when", label: "when" },
            { key: "action", label: "action" },
            { key: "who", label: "who" },
            { key: "resource", label: "resource" },
            { key: "detail", label: "detail" },
          ]}
          rows={entries.map(function renderEntry(entry) {
            return [
              <Time key="t" at={entry.createdAt} mode="absolute" className="font-mono text-[11.5px] text-ink-faint" />,
              <span key="a" className="font-mono text-[12px] text-ink">{entry.action}</span>,
              entry.userId ? (
                <Link key="w" href={`/trafalgar/users/${entry.userId}`} className="text-ink-soft hover:underline">
                  {entry.userName ?? shortId(entry.userId)}
                </Link>
              ) : (
                <span key="w" className="text-ink-faint">{entry.actorType}{entry.actorId ? ` ${shortId(entry.actorId)}` : ""}</span>
              ),
              <span key="r" className="font-mono text-[11.5px] text-ink-faint">
                {entry.resourceType ? `${entry.resourceType} ${shortId(entry.resourceId ?? "")}` : "—"}
              </span>,
              <span key="d" className="line-clamp-2 max-w-md break-all font-mono text-[11px] text-ink-faint">
                {entry.metadata ? JSON.stringify(entry.metadata) : ""}
              </span>,
            ];
          })}
        />
      )}
    </div>
  );
}
