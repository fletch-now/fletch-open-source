import { RegistryPageIntro } from "@/components/registry/page-intro";
import { RegistryPagination, readPage } from "@/components/registry/pagination";
import type { ReactElement } from "react";
import { TableShell } from "@/components/registry/table-shell";
import { publicPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import Link from "@/components/ui/navigation-link";
import { RegistryFooter } from "@/components/registry/registry-footer";
import { RH_MAINNET_ID } from "@/lib/config";
import { listAssets } from "@/lib/registry/assets";
import { issuerDocumentsAll, issuerPagesAll, type IssuerDocument } from "@/lib/registry/authority/issuer";
import { lastRunOf } from "@/lib/registry/authority/runs";
import { ago, dayText } from "@/components/registry/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = publicPageMetadata("/registry/issuer");

const KIND_LABEL: Record<string, string> = {
  base_prospectus: "Master legal prospectus",
  supplement: "Prospectus supplements",
  notice: "Notices and amendments",
  final_terms: "Per-token legal filings",
  other: "Other documents",
};

function group(documents: IssuerDocument[]): Array<{ kind: string; label: string; documents: IssuerDocument[] }> {
  const order = ["base_prospectus", "supplement", "notice", "final_terms", "other"];
  return order
    .map((kind) => ({ kind, label: KIND_LABEL[kind], documents: documents.filter((doc) => doc.kind === kind && doc.goneAt === null) }))
    .filter((entry) => entry.documents.length > 0);
}

function sizeText(bytes: bigint | null): string {
  return bytes === null ? "" : `${(Number(bytes) / 1_048_576).toFixed(1)} MB`;
}

export default async function IssuerPage({ searchParams }: PageProps<"/registry/issuer">): Promise<ReactElement> {
  const params = await searchParams;
  const [documents, pages, assets, run] = await Promise.all([issuerDocumentsAll(), issuerPagesAll(), listAssets(RH_MAINNET_ID), lastRunOf("issuer-docs")]);
  const symbols = new Map(assets.map((asset) => [asset.id, asset.symbol]));
  const groups = group(documents);
  const mapped = documents.filter((doc) => doc.assetId).length;
  const finalTerms = documents.filter((doc) => doc.kind === "final_terms" && doc.goneAt === null).length;

  return (
    <div className="relative flex flex-1 flex-col">
      <main className="w-full px-4 pb-16 pt-6 sm:px-6 lg:px-8">
        <RegistryPageIntro title="Issuer documents" actions={<><a href={`/api/v1/chains/${RH_MAINNET_ID}/issuer`}>JSON</a><Link href="/registry/changes?kind=issuer.">Document changes</Link></>}>
          {documents.filter((doc) => doc.goneAt === null).length} documents on record, including {finalTerms} Final Terms. {mapped} mapped to tokens. Last read {run?.finishedAt ? ago(run.finishedAt) : "not yet"}.
        </RegistryPageIntro>
        {groups.map(function renderGroup(entry) {
          const pageParam = `${entry.kind}_page`;
          const pagination = readPage({ ...params, page: params[pageParam] });
          const shown = entry.documents.slice(pagination.offset, pagination.offset + pagination.pageSize);
          return (
            <section id={entry.kind} key={entry.kind} className="mt-4 scroll-mt-6">
              <h2 className="text-[18px] font-medium text-ink">
                {entry.label} <span className="font-mono text-[13px] text-ink-faint">{entry.documents.length}</span>
              </h2>
              <RegistryPagination basePath="/registry/issuer" params={params} {...pagination} pageParam={pageParam} total={entry.documents.length} anchor={entry.kind} />
              <TableShell label={entry.label} className="mt-3">
                <table className="w-full min-w-[640px] text-left">
                  <thead>
                    <tr className="border-b border-line text-[11.5px] uppercase tracking-[0.08em] text-ink-faint">
                      <th scope="col" className="px-4 py-3 font-medium">Document</th>
                      <th scope="col" className="px-4 py-3 font-medium">Token</th>
                      <th scope="col" className="px-4 py-3 font-medium">Last modified</th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">Size</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {shown.length === 0 ? <tr><td colSpan={4}>No documents on this page. Use the page controls to return to the recorded documents.</td></tr> : null}
                    {shown.map(function renderDoc(doc) {
                      const symbol = doc.assetId ? symbols.get(doc.assetId) : null;
                      return (
                        <tr key={doc.url}>
                          <td className="px-4 py-2.5 text-[13px] text-ink">
                            <a href={doc.url} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                              {doc.title}
                            </a>
                            {doc.changedAt ? <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-800">revised {ago(doc.changedAt)}</span> : null}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[12.5px]">
                            {symbol ? (
                              <Link href={`/registry/${symbol}`} className="text-ink underline-offset-4 hover:underline">
                                {symbol}
                              </Link>
                            ) : (
                              <span className="text-ink-faint">{doc.underlying ? "not listed on chain" : "—"}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[12px] text-ink-soft">{dayText(doc.lastModified)}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-[12px] text-ink-faint">{sizeText(doc.bytes)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableShell>
              <RegistryPagination basePath="/registry/issuer" params={params} {...pagination} pageParam={pageParam} total={entry.documents.length} anchor={entry.kind} />
            </section>
          );
        })}
        {groups.length === 0 ? <p className="mt-8 rounded-card border border-dashed border-line bg-panel/40 px-5 py-8 text-[14px] text-ink-soft">The legal hub has not been read yet.</p> : null}
        <section className="mt-8 grid gap-px overflow-hidden rounded-card border border-line bg-line md:grid-cols-3" aria-label="Why this page exists">
          <div className="bg-raised px-5 py-4">
            <p className="mono-label">filings and addresses</p>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              Each Final Terms names a company; Fletch ties it to the on-chain contract for that ticker. A token whose ticker
              has no filing or a different contract address is marked for comparison. A matching name alone does not confirm the issuer.
            </p>
          </div>
          <div className="bg-raised px-5 py-4">
            <p className="mono-label">early notice</p>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              A filing can appear before a token is listed. Recorded publication dates let you compare issuer documents
              with the listing history; they do not guarantee a future listing.
            </p>
          </div>
          <div className="bg-raised px-5 py-4">
            <p className="mono-label">change tracking</p>
            <p className="mt-2 text-[14px] leading-6 text-ink-soft">
              Each document is tracked by the CDN&apos;s own ETag and size, each rules page by a SHA-256 of its text. A
              revised prospectus, a changed jurisdiction list or a corporate-action notice becomes an event, and anyone
              watching the issuer gets an alert.
            </p>
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-[18px] font-medium text-ink">Core terms and operating rules</h2>
          <p className="mt-1 text-[13.5px] leading-6 text-ink-soft">The pages whose wording binds holders: restricted jurisdictions, corporate actions, upgrade and amendment notices. Each is hashed; a changed hash is a changelog event.</p>
          <ul className="mt-3 divide-y divide-line rounded-card border border-line bg-raised">
            {pages.map(function renderPage(page) {
              return (
                <li key={page.slug} className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-3 text-[13.5px]">
                  <a href={page.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-4 hover:underline">
                    {page.title ?? page.slug}
                  </a>
                  <span className="font-mono text-[11.5px] text-ink-faint">
                    {page.changedAt ? `changed ${ago(page.changedAt)}` : `unchanged since first seen ${ago(page.firstSeenAt)}`} · sha256 {page.sha256.slice(0, 12)}
                  </span>
                </li>
              );
            })}
            {pages.length === 0 ? <li className="px-5 py-4 text-[13px] text-ink-soft">Not read yet.</li> : null}
          </ul>
        </section>

      </main>
      <RegistryFooter />
    </div>
  );
}
