import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { listUsers } from "@/lib/admin/queries";
import { EmptyState, PageHeader, StatusChip, Table, Time } from "@/components/dashboard/ui";
import { shortAddress } from "@/components/admin/format";

// Every account, newest first, with the four numbers that say how it uses the
// platform. Search matches handle, wallet, email, or the raw id.
export default async function AdminUsersPage({ searchParams }: PageProps<"/trafalgar/users">) {
  await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q : "";
  const users = await listUsers(q);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Users"
        description="One row per wallet account. Open a row to see its ledger, builds, watchers, keys, and to adjust it."
        actions={
          <form method="get" className="flex items-center gap-2">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="handle, wallet, or id"
              className="h-9 w-56 rounded-full border border-line bg-paper px-4 text-[13px] text-ink placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
            />
            <button type="submit" className="h-9 rounded-full bg-ink px-4 text-[12.5px] font-medium text-paper">
              Search
            </button>
          </form>
        }
      />

      {users.length === 0 ? (
        <EmptyState
          title={q ? "No account matches that search" : "No accounts yet"}
          body={q ? "Try part of a handle or a wallet address." : "The first wallet to sign in will appear here."}
        />
      ) : (
        <Table
          columns={[
            { key: "account", label: "account" },
            { key: "wallet", label: "wallet" },
            { key: "credits", label: "credits", align: "right" },
            { key: "projects", label: "projects", align: "right" },
            { key: "builds", label: "builds", align: "right" },
            { key: "watchers", label: "watchers", align: "right" },
            { key: "telegram", label: "telegram" },
            { key: "last", label: "last build", align: "right" },
            { key: "joined", label: "joined", align: "right" },
          ]}
          rows={users.map(function renderUser(row) {
            return [
              <span key="name" className="inline-flex flex-wrap items-center gap-2">
                <Link href={`/trafalgar/users/${row.id}`} className="font-medium text-ink hover:underline">
                  {row.name ?? "—"}
                </Link>
                {row.role === "admin" ? <StatusChip tone="info">admin</StatusChip> : null}
                {row.banned ? <StatusChip tone="bad">banned</StatusChip> : null}
              </span>,
              <span key="wallet" className="font-mono text-[12px] text-ink-soft">
                {row.wallet ? shortAddress(row.wallet) : (row.email ?? "—")}
              </span>,
              row.credits,
              row.projectCount,
              row.buildCount,
              row.watcherCount,
              row.telegramLinked ? "linked" : <span className="text-ink-faint">no</span>,
              row.lastBuildAt ? <Time key="last" at={row.lastBuildAt} className="font-mono text-[11.5px] text-ink-faint" /> : <span className="text-ink-faint">never</span>,
              <Time key="joined" at={row.createdAt} className="font-mono text-[11.5px] text-ink-faint" />,
            ];
          })}
        />
      )}
    </div>
  );
}
