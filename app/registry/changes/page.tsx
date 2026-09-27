import Form from "next/form";
import { RegistryPageIntro } from "@/components/registry/page-intro";
import { FilterMenu } from "@/components/registry/filter-menu";
import { RefreshReading } from "@/components/registry/refresh-reading";
import { groupChangelog } from "@/lib/registry/changelog-groups";
import { readAppCatalog } from "@/lib/registry/app-catalog";
import { AppCatalogHealth } from "@/components/registry/app-status";
import { RegistryPagination, readPage } from "@/components/registry/pagination";
import { TableShell } from "@/components/registry/table-shell";
import { publicPageMetadata } from "@/lib/seo";
import { eventKindLabel } from "@/lib/registry/authority/events";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { RH_MAINNET_ID } from "@/lib/config";
import { explorerTxUrl } from "@/lib/chain/explorer";
import { AUTHORITY_EVENT_KINDS } from "@/lib/registry/authority/events";
import { authorityEventCounts, recentAuthorityEvents, type AuthorityEvent, changelogStart } from "@/lib/registry/authority/read";
import { ago, shortHex } from "@/components/registry/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata("/registry/changes");

// The groups a reader filters by; a prefix matches every kind under it.
const KIND_GROUPS: Array<{ key: string; label: string }> = [
  { key: "", label: "All" },
  { key: "registry.", label: "Registry" },
  { key: "token.", label: "Tokens" },
  { key: "multiplier.", label: "Multipliers" },
  { key: "feed.", label: "Feeds" },
  { key: "supply.", label: "Supply" },
  { key: "listing.", label: "Listings" },
  { key: "corporate.", label: "Corporate actions" },
  { key: "dex.", label: "DEX" },
  { key: "bridge.", label: "Bridge" },
  { key: "lookalike.", label: "Lookalikes" },
  { key: "issuer.", label: "Issuer" },
  { key: "chain.", label: "Chain" },
];

const PAGE_LIMIT = 200;

// Colour by what a reader should do with the row: red is a warning about a
// token, amber something to look at, green a healthy change, blue value
// crossing the bridge, grey the rest.
function toneFor(kind: string): string {
  if (kind === "lookalike.found" || kind === "token.noncanonical") {
    return "bg-red-50 text-red-700";
  }
  if (/paused|halted|stale|residual|blocked|degraded/.test(kind)) {
    return "bg-amber-50 text-amber-800";
  }
  if (/unpaused|resumed|fresh|reconciled|\.canonical|unblocked|operational|listing|pool_new/.test(kind)) {
    return "bg-hood-wash text-hood-deep";
  }
  if (kind.startsWith("bridge.")) {
    return "bg-sky-50 text-sky-800";
  }
  return "bg-panel text-ink-soft";
}

function whereLink(event: AuthorityEvent): { href: string; label: string } | null {
  if (event.txHash) {
    return { href: explorerTxUrl(event.chainId, event.txHash), label: `tx ${shortHex(event.txHash)}` };
  }
  if (event.symbol) {
    return { href: `/registry/markets?q=${encodeURIComponent(event.symbol)}`, label: event.symbol };
  }
  return null;
}

function parseKind(value: string | string[] | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  const exact = (AUTHORITY_EVENT_KINDS as readonly string[]).includes(value);
  const group = KIND_GROUPS.some((entry) => entry.key === value);
  return exact || group ? value : "";
}

export default async function ChangesPage({ searchParams }: PageProps<"/registry/changes">) {
  const params = await searchParams;
  const kind = parseKind(params.kind);
  const pagination = readPage(params);
  const symbol = typeof params.symbol === "string" ? params.symbol.toUpperCase().slice(0, 64) : "";
  const [events, counts, started, listings] = await Promise.all([
    recentAuthorityEvents(RH_MAINNET_ID, { kind: kind || undefined, symbol: symbol || undefined, limit: PAGE_LIMIT }),
    authorityEventCounts(RH_MAINNET_ID, 7),
    changelogStart(RH_MAINNET_ID, 7),
    recentAuthorityEvents(RH_MAINNET_ID, { kind: "listing.", symbol: symbol || undefined, limit: 3 }),
  ]);
  const groups = groupChangelog(events);
  const pageEvents = groups.slice(pagination.offset, pagination.offset + pagination.pageSize);
  const weekTotal = counts.reduce((sum, entry) => sum + entry.count, 0);
  const sinceText = started.withinWindow && started.at ? `${weekTotal} recorded since the registry started on ${started.at.toISOString().slice(0, 10)}` : `${weekTotal} in the last seven days`;
  const query = `${symbol ? `&symbol=${encodeURIComponent(symbol)}` : ""}${pagination.pageSize === 50 ? "&size=50" : ""}`;

  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Registry changelog" actions={<><a href={`/api/v1/chains/${RH_MAINNET_ID}/events?${new URLSearchParams({kind, symbol, limit: String(PAGE_LIMIT)})}`}>JSON</a><a href="/registry/changes.xml">Atom</a><Link href="/dashboard/watch/new?kind=registry_event">Watch</Link><RefreshReading /></>}>
          Recorded changes, timestamped when Fletch observed them. Same-token pool bursts are grouped.
        </RegistryPageIntro>
        {(!kind || kind.startsWith("listing.")) && listings[0] ? <section aria-label="Latest Robinhood catalog observation" className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-hood-deep/25 bg-hood-wash px-3 py-2 text-[13px]"><Link href="/registry/changes?kind=listing." className="font-medium underline underline-offset-4">Latest listing observation</Link><p className="min-w-0">{listings[0].title} <time className="whitespace-nowrap text-ink-soft" dateTime={listings[0].observedAt.toISOString()} title={listings[0].observedAt.toISOString()}>{ago(listings[0].observedAt)}</time></p></section> : null}
        <section aria-label="Filter registry changes" className="mt-3">
          <Form scroll={false} action="/registry/changes" className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 sm:max-w-xs">
              <label htmlFor="changes-symbol" className="sr-only">Token symbol</label>
              <input id="changes-symbol" name="symbol" defaultValue={symbol} placeholder="Token symbol, e.g. TSLA" className="h-10 w-full rounded-lg border border-line px-3 text-[14px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink" />
            </div>
            {kind ? <input type="hidden" name="kind" value={kind} /> : null}
            {pagination.pageSize === 50 ? <input type="hidden" name="size" value="50" /> : null}
            <button type="submit" className="h-10 rounded-lg bg-ink px-5 text-[14px] font-medium text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">Search</button>
          </Form>
          <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Event type">
            <FilterMenu label="Events" value={KIND_GROUPS.find((group) => group.key === kind)?.label ?? eventKindLabel(kind)} options={KIND_GROUPS.map((group) => ({label: group.label, active: kind === group.key, href: `/registry/changes?kind=${encodeURIComponent(group.key)}${query}`, count: group.key ? counts.filter((entry) => entry.kind.startsWith(group.key)).reduce((sum, entry) => sum + entry.count, 0) : weekTotal}))} />
            <p className="text-[12px] text-ink-soft">{sinceText}.</p>
          </div>
          {symbol || kind ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink">
              <span className="font-medium">Applied</span>
              {symbol ? <Link aria-label={`Remove symbol filter ${symbol}`} href={`/registry/changes?kind=${encodeURIComponent(kind)}`} className="rounded-full border border-line px-3 py-1.5 hover:bg-panel">Symbol: {symbol} <span aria-hidden="true">×</span></Link> : null}
              {kind ? <Link aria-label="Remove event type filter" href={`/registry/changes${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ""}`} className="rounded-full border border-line px-3 py-1.5 hover:bg-panel">{KIND_GROUPS.find((group) => group.key === kind)?.label ?? eventKindLabel(kind)} <span aria-hidden="true">×</span></Link> : null}
              <Link href="/registry/changes" className="ml-auto underline underline-offset-4">Reset filters</Link>
            </div>
          ) : null}
        </section>

        <RegistryPagination basePath="/registry/changes" params={params} {...pagination} total={groups.length} compact />
        {pageEvents.length === 0 ? (
          <div className="mt-8 rounded-card border border-dashed border-line bg-panel/40 px-6 py-14 text-center">
            <p className="text-[15px] text-ink">{events.length ? "No observations on this page." : "Nothing recorded for this filter yet."}</p>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-6 text-ink-soft">
              {events.length ? (
                <Link href={`/registry/changes?kind=${encodeURIComponent(kind)}${query}`} className="underline underline-offset-4">Return to the first page of matching observations.</Link>
              ) : (
                <>No matching observation is recorded. Check indexing freshness and coverage on the Status page.</>
              )}
            </p>
          </div>
        ) : (
          <TableShell label="Recorded registry changes" className="mt-1">
            <table className="w-full min-w-[720px] text-left">
              <thead>
                <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                  <th scope="col" className="px-4 py-3 font-medium">Observed</th>
                  <th scope="col" className="px-4 py-3 font-medium">Kind</th>
                  <th scope="col" className="px-4 py-3 font-medium">Change</th>
                  <th scope="col" className="px-4 py-3 font-medium">Where</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {pageEvents.map(function renderEvent({ event, members }) {
                  const where = whereLink(event);
                  return (
                    <tr key={event.id} className={`align-top ${event.kind.startsWith("listing.") ? "bg-hood-wash/40" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-3 text-[12.5px] text-ink-faint" title={event.observedAt.toISOString()}>
                        {ago(event.observedAt)}
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/registry/changes?kind=${encodeURIComponent(event.kind)}${query}`} title={event.kind} className={`inline-flex rounded-full px-2 py-0.5 text-[11.5px] ${toneFor(event.kind)}`}>
                          {eventKindLabel(event.kind)}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-[13.5px] text-ink">
                        {event.symbol && !event.title.startsWith(event.symbol) ? (
                          <Link href={`/registry/${encodeURIComponent(event.symbol)}`} className="mr-1.5 font-medium underline-offset-4 hover:underline">
                            {event.symbol}
                          </Link>
                        ) : null}
                        {members.length > 1 ? <details><summary className="cursor-pointer font-medium">{members.length} new {event.symbol ?? "same-token"} pools in 30 min</summary><ul className="mt-2 space-y-2">{members.map((member) => <li key={member.id}>{member.title} <time dateTime={member.observedAt.toISOString()}>{member.observedAt.toISOString()}</time>{member.txHash ? <a className="ml-2 underline" href={explorerTxUrl(member.chainId, member.txHash)}>Transaction</a> : null}</li>)}</ul></details> : event.title}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-ink-faint">
                        {where ? (
                          <a href={where.href} target={event.txHash ? "_blank" : undefined} rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                            {where.label}
                          </a>
                        ) : (
                          "chain"
                        )}
                        {event.blockNumber !== null ? <span className="ml-2">#{event.blockNumber.toString()}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableShell>
        )}
        <RegistryPagination basePath="/registry/changes" params={params} {...pagination} total={groups.length} />
        <details className="mt-5 text-[13px] leading-5 text-ink-soft"><summary className="cursor-pointer text-ink">History, coverage and live integrations</summary><p className="mt-2">This page groups the latest {PAGE_LIMIT} matching observations. Counts cover seven days; indexed history starts when a source is first read. Observation time can differ from the source event time. A lookalike label records a naming collision, without establishing intent.</p><p className="mt-2">Use the <a href={`/api/v1/chains/${RH_MAINNET_ID}/events/stream`} className="underline">live stream</a> and <a href="/skill.md" className="underline">AI guide</a> for cursor catch-up and reconnects. Check <Link href="/registry/status" className="underline">source freshness</Link> separately.</p></details>
        <AppCatalogHealth reading={await readAppCatalog()} />
      </main>
      <RegistryFooter />
    </div>
  );
}
