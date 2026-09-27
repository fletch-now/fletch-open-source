import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { requireAdmin } from "@/lib/dal";
import { adminListings } from "@/lib/apps/directory";
import { LISTING_LABELS } from "@/lib/apps/types";
import { reviewApp } from "@/lib/admin/app-actions";
import { ActionForm } from "@/components/admin/action-form";
import { PageHeader } from "@/components/dashboard/ui";

export default async function AdminAppsPage({
  searchParams,
}: PageProps<"/trafalgar/apps">): Promise<ReactElement> {
  await requireAdmin();
  const params = await searchParams;
  const state =
    typeof params.state === "string" &&
    ["all", ...Object.keys(LISTING_LABELS)].includes(params.state)
      ? params.state
      : "pending";
  const page = Math.max(
    1,
    Math.min(1000, Math.floor(Number(params.page) || 1)),
  );
  const rows = await adminListings(state, page);
  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="App directory"
        description="Review the owner's description and published app before approving a listing. Approval applies to that build. Owners retain control of whether their listing is public."
      />
      <nav
        aria-label="Listing review filters"
        className="mb-6 flex flex-wrap gap-2"
      >
        {["pending", "approved", "rejected", "suspended", "draft", "all"].map(
          function filter(value) {
            return (
              <Link
                key={value}
                href={`/trafalgar/apps?state=${value}`}
                aria-current={state === value ? "page" : undefined}
                className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm aria-[current=page]:bg-ink aria-[current=page]:text-paper"
              >
                {value === "all"
                  ? "All"
                  : LISTING_LABELS[value as keyof typeof LISTING_LABELS]}
              </Link>
            );
          },
        )}
      </nav>
      <div className="space-y-5">
        {rows.slice(0, 50).map(function item(row) {
          const fields = {
            projectId: row.projectId,
            version: String(row.version),
          };
          return (
            <article
              key={`${row.projectId}:${row.version}`}
              className="rounded-card border border-line bg-raised p-5 sm:p-6"
            >
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="display break-words text-2xl">{row.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-ink-soft">
                    {row.summary}
                  </p>
                </div>
                <span className="rounded-full bg-panel px-3 py-1 text-xs">
                  {LISTING_LABELS[row.state]} · v{row.version}
                </span>
              </header>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-ink-soft">
                {row.description}
              </p>
              <dl className="my-5 grid gap-3 text-xs text-ink-soft sm:grid-cols-2">
                <div>
                  <dt>Owner consent</dt>
                  <dd className="mt-1 font-medium text-ink">
                    {row.optedIn ? "Submitted for public listing" : "Private"}
                  </dd>
                </div>
                <div>
                  <dt>Current visibility</dt>
                  <dd className="mt-1 font-medium text-ink">
                    {row.public ? "Public" : "Hidden"}
                  </dd>
                </div>
                <div>
                  <dt>Submitted build</dt>
                  <dd className="mt-1 break-all font-mono">
                    {row.buildId ?? "Draft"}
                  </dd>
                </div>
                <div>
                  <dt>Project</dt>
                  <dd className="mt-1 break-all font-mono">{row.slug}</dd>
                </div>
              </dl>
              {row.token ? (
                <div className="my-5 rounded-xl border border-line p-4 text-sm leading-6">
                  <p>
                    {row.token.name} ({row.token.symbol}) · chain{" "}
                    {row.token.chainId}
                  </p>
                  <p className="break-all font-mono text-xs">
                    {row.token.address}
                  </p>
                  <p className="mt-2 text-xs text-ink-soft">
                    Metadata checked {row.token.checkedAt} at block{" "}
                    {row.token.blockNumber}. Source verification:{" "}
                    {row.token.sourceVerified ? "confirmed" : "not confirmed"}.
                  </p>
                </div>
              ) : null}
              <div className="mb-5 flex flex-wrap gap-x-6">
                {row.liveUrl ? (
                  <a
                    href={row.liveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-11 items-center text-sm text-hood-deep underline"
                  >
                    Inspect hosted app ↗
                  </a>
                ) : null}
                {row.public ? (
                  <Link
                    href={`/published/${row.slug}`}
                    className="inline-flex min-h-11 items-center text-sm text-hood-deep underline"
                  >
                    Public listing ↗
                  </Link>
                ) : null}
              </div>
              {row.reviewNote ? (
                <p className="mb-4 text-sm leading-6 text-ink-soft">
                  Last review note: {row.reviewNote}
                </p>
              ) : null}
              <div className="flex flex-col gap-4 border-t border-line pt-5 [&_button]:min-h-11">
                {row.state === "pending" && row.optedIn ? (
                  <ActionForm
                    action={reviewApp}
                    fields={{ ...fields, action: "approve", note: "" }}
                    label="Approve listing"
                    tone="primary"
                  />
                ) : null}
                {row.state === "approved" ? (
                  <ActionForm
                    action={reviewApp}
                    fields={{
                      ...fields,
                      action: row.featured ? "unfeature" : "feature",
                      note: "",
                    }}
                    label={
                      row.featured ? "Remove feature" : "Feature in directory"
                    }
                  />
                ) : null}
                {row.state === "suspended" ? (
                  <ActionForm
                    action={reviewApp}
                    fields={{
                      ...fields,
                      action: "reopen",
                      note: "The listing can be edited and submitted again.",
                    }}
                    label="Reopen for owner submission"
                  />
                ) : (
                  <ActionForm
                    action={reviewApp}
                    fields={fields}
                    label="Save review"
                    tone="danger"
                    className="!items-start"
                  >
                    <label className="flex min-w-0 flex-col gap-1 text-xs text-ink-soft">
                      Decision
                      <select
                        name="action"
                        className="min-h-11 rounded-lg border border-line bg-paper px-3 text-sm text-ink"
                      >
                        <option value="reject">Request changes</option>
                        <option value="suspend">Hide and suspend</option>
                      </select>
                    </label>
                    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink-soft">
                      Reason shown to the owner
                      <input
                        name="note"
                        required
                        minLength={5}
                        maxLength={500}
                        className="min-h-11 w-full min-w-[160px] rounded-lg border border-line bg-paper px-3 text-sm text-ink"
                      />
                    </label>
                  </ActionForm>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-8 text-sm text-ink-soft">
          No listings in this view.
        </p>
      ) : null}
      <nav
        aria-label="Review pages"
        className="mt-6 flex justify-between gap-4"
      >
        {page > 1 ? (
          <Link
            href={`/trafalgar/apps?state=${state}&page=${page - 1}`}
            className="min-h-11 text-sm underline"
          >
            Previous
          </Link>
        ) : (
          <span />
        )}
        {rows.length > 50 ? (
          <Link
            href={`/trafalgar/apps?state=${state}&page=${page + 1}`}
            className="min-h-11 text-sm underline"
          >
            Next
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
