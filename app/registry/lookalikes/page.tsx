import Form from "next/form";
import { RegistryPageIntro } from "@/components/registry/page-intro";
import { TableShell } from "@/components/registry/table-shell";
import { publicPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { RegistryPagination, pageHref, readPage } from "@/components/registry/pagination";
import { TrustBadge } from "@/components/registry/trust-badge";
import { lookalikeReason } from "@/components/registry/lookalike-reason";
import { RH_MAINNET_ID } from "@/lib/config";
import { lookalikeTotals, lookalikesPage } from "@/lib/registry/authority/read";
import { lastRunOf } from "@/lib/registry/authority/runs";
import { trustForTokens } from "@/lib/registry/trust";
import { ago } from "@/components/registry/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = publicPageMetadata("/registry/lookalikes");

const KINDS = [
  { key: "", label: "All matches" },
  { key: "impostor", label: "Name or issuer reference" },
  { key: "same_ticker", label: "Same ticker" },
  { key: "unverified", label: "Origin unconfirmed" },
];

export default async function LookalikesPage({ searchParams }: PageProps<"/registry/lookalikes">): Promise<ReactElement> {
  const params = await searchParams;
  const kind = typeof params.kind === "string" && KINDS.some((item) => item.key === params.kind) ? params.kind : "";
  const symbol = typeof params.q === "string" ? params.q.trim().replace(/^\$/, "").toUpperCase().slice(0, 64) : "";
  const pagination = readPage(params);
  const [result, totals, run] = await Promise.all([
    lookalikesPage(RH_MAINNET_ID, { symbol: symbol || undefined, kind: kind || undefined, limit: pagination.pageSize, offset: pagination.offset }),
    lookalikeTotals(RH_MAINNET_ID), lastRunOf("lookalikes"),
  ]);
  const trust = await trustForTokens(RH_MAINNET_ID, result.rows.map((row) => row.address));
  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Lookalike tokens" actions={<a href={`/api/v1/chains/${RH_MAINNET_ID}/lookalikes?${new URLSearchParams({symbol, kind, limit: String(pagination.pageSize), offset: String(pagination.offset)})}`}>JSON</a>}>Contracts sharing a name or ticker with a listed asset. Compare addresses; a naming collision does not establish intent.</RegistryPageIntro>
        <p className="mt-3 text-[13px] leading-6 text-ink-soft">
          {totals.total.toLocaleString("en-US")} matches recorded across {totals.tickers.toLocaleString("en-US")} tickers.
          {" "}Last scan {run?.finishedAt ? ago(run.finishedAt) : "unavailable"}.
          {run?.ok === false ? " The last scan was incomplete; retained matches remain available." : null}
          {" "}<a href={`/api/v1/chains/${RH_MAINNET_ID}/lookalikes`} className="underline underline-offset-4">Read the JSON</a>.
        </p>
        <section aria-label="Filter matching tokens" className="mt-3">
          <Form scroll={false} action="/registry/lookalikes" className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1 sm:max-w-sm">
              <label className="sr-only" htmlFor="lookalike-q">Listed ticker</label>
              <input id="lookalike-q" name="q" defaultValue={symbol} placeholder="Search a ticker, e.g. TSLA" className="h-10 w-full rounded-lg border border-line bg-raised px-3 text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" />
            </div>
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            {pagination.pageSize === 50 ? <input type="hidden" name="size" value="50" /> : null}
            <button type="submit" className="h-10 rounded-lg bg-ink px-5 text-[14px] font-medium text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Search</button>
          </Form>
          <div className="mt-2 flex flex-wrap items-center gap-2" role="group" aria-label="Match type">
            <span className="mr-1 text-[13px] font-medium text-ink">Match type</span>
            {KINDS.map(function kindLink(item): ReactElement {
              return <Link key={item.key} href={pageHref("/registry/lookalikes", { q: symbol, kind: item.key }, 1, pagination.pageSize)} aria-current={kind === item.key ? "true" : undefined} className={`rounded-lg border px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${kind === item.key ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-panel"}`}>{item.label}</Link>;
            })}
          </div>
          {symbol || kind ? (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[13px] text-ink">
              <span className="font-medium">Applied</span>
              {symbol ? <Link aria-label={`Remove ticker filter ${symbol}`} href={pageHref("/registry/lookalikes", { kind }, 1, pagination.pageSize)} className="rounded-full border border-line px-3 py-1.5 hover:bg-panel">Ticker: {symbol} <span aria-hidden="true">×</span></Link> : null}
              {kind ? <Link aria-label="Remove match type filter" href={pageHref("/registry/lookalikes", { q: symbol }, 1, pagination.pageSize)} className="rounded-full border border-line px-3 py-1.5 hover:bg-panel">{KINDS.find((item) => item.key === kind)?.label} <span aria-hidden="true">×</span></Link> : null}
              <Link href={pageHref("/registry/lookalikes", {}, 1, pagination.pageSize)} className="ml-auto underline underline-offset-4">Reset filters</Link>
            </div>
          ) : null}
        </section>
        <RegistryPagination basePath="/registry/lookalikes" params={params} {...pagination} total={result.total} compact />
        {result.rows.length === 0 ? <p className="mt-6 rounded-card border border-line px-5 py-8 text-[14px] text-ink-soft">No recorded matches on this page. Change the filters or return to the first page.</p> : (
          <TableShell label="Recorded matching tokens" className="mt-1">
            <table className="w-full min-w-[850px] text-left">
              <thead><tr className="border-b border-line text-[12px] text-ink-soft">
                <th scope="col" className="px-4 py-3 font-medium">Listed match</th><th scope="col" className="px-4 py-3 font-medium">Token and address</th><th scope="col" className="px-4 py-3 font-medium">Identity</th><th scope="col" className="px-4 py-3 font-medium">Recorded check</th>
              </tr></thead>
              <tbody className="divide-y divide-line">{result.rows.map(function tokenRow(row): ReactElement {
                const verdict = trust.get(row.address);
                return <tr key={row.id}>
                  <td className="px-4 py-3"><Link href={`/registry/${encodeURIComponent(row.matchesSymbol)}`} className="font-mono text-[13px] underline underline-offset-4">{row.matchesSymbol}</Link></td>
                  <td className="px-4 py-3"><Link href={`/registry/markets/${row.address}`} className="text-[14px] font-medium underline-offset-4 hover:underline">{row.symbol ?? "Unknown symbol"}</Link><p className="text-[12px] text-ink-soft">{row.name ?? "Name unavailable"}</p><p className="mt-1 break-all font-mono text-[11px] text-ink-soft">{row.address}</p></td>
                  <td className="px-4 py-3"><TrustBadge level={verdict?.level ?? "unknown"} detail={verdict?.detail} /></td>
                  <td className="max-w-[280px] px-4 py-3 text-[13px] leading-5 text-ink-soft">{lookalikeReason(row)}<p className="mt-1 text-[11px]">Observed {ago(row.lastSeenAt)}</p></td>
                </tr>;
              })}</tbody>
            </table>
          </TableShell>
        )}
        <RegistryPagination basePath="/registry/lookalikes" params={params} {...pagination} total={result.total} />
      </main>
      <RegistryFooter />
    </div>
  );
}
