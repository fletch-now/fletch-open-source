import { cache, type ReactElement } from "react";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import Link from "@/components/ui/navigation-link";
import { DirectoryShell } from "@/components/apps/directory-shell";
import { getPublicApp } from "@/lib/apps/directory";
import { canonical, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { explorerAddressUrl } from "@/lib/chain/explorer";
import { formatUnits } from "viem";

export const dynamic = "force-dynamic";
const readApp = cache(getPublicApp);

export async function generateMetadata({
  params,
}: PageProps<"/published/[slug]">): Promise<Metadata> {
  const app = await readApp((await params).slug);
  if (!app) notFound();
  if ((await params).slug !== app.slug) permanentRedirect(`/published/${app.slug}`);
  const metadata = pageMetadata(
    `/published/${app.slug}`,
    app.title,
    app.summary,
  );
  metadata.alternates = {
    ...metadata.alternates,
    types: { "application/json": canonical(`/api/v1/apps/${app.slug}`) },
  };
  return metadata;
}

export default async function PublishedAppPage({
  params,
}: PageProps<"/published/[slug]">): Promise<ReactElement> {
  const app = await readApp((await params).slug);
  if (!app) notFound();
  if ((await params).slug !== app.slug) permanentRedirect(`/published/${app.slug}`);
  const token = app.token;
  const schema = [
    breadcrumbJsonLd([
      { name: "Home", path: "/" },
      { name: "Apps", path: "/published" },
      { name: app.title, path: `/published/${app.slug}` },
    ]),
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: app.title,
      description: app.summary,
      url: canonical(`/published/${app.slug}`),
      installUrl: app.liveUrl,
      operatingSystem: "Web browser",
      image: canonical(`/published/${app.slug}/opengraph-image`),
      datePublished: app.listedAt,
      dateModified: app.updatedAt,
    },
  ];
  return (
    <DirectoryShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replaceAll("<", "\\u003c"),
        }}
      />
      <nav aria-label="Breadcrumb" className="mb-7 flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <Link href="/" className="inline-flex min-h-11 items-center underline underline-offset-4">Home</Link><span aria-hidden="true">/</span>
        <Link href="/published" className="inline-flex min-h-11 items-center underline underline-offset-4">Apps</Link><span aria-hidden="true">/</span>
        <span aria-current="page">{app.title}</span>
      </nav>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-6 border-b border-line pb-8">
        <div className="min-w-0 max-w-3xl">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.15em] text-hood-deep">
            Built with Fletch ·{" "}
            {app.featured ? "Featured app" : "Beta directory"}
          </p>
          <h1 className="display break-words text-[clamp(2rem,5vw,3.5rem)] leading-[1.1] tracking-tight">
            {app.title}
          </h1>
          <p className="mt-4 text-lg leading-8 text-ink-soft">{app.summary}</p>
        </div>
        <a
          href={app.liveUrl}
          target="_blank"
          rel="noopener noreferrer ugc"
          className="inline-flex min-h-12 shrink-0 items-center gap-4 rounded-full bg-hood px-6 text-sm font-semibold text-ink hover:bg-hood-strong"
        >
          Open live app <span aria-hidden="true">↗</span>
        </a>
      </header>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <h2 className="display text-2xl">About this app</h2>
          <p className="mt-5 whitespace-pre-wrap break-words text-[15px] leading-8 text-ink-soft">
            {app.description}
          </p>
          <p className="mt-6 text-xs leading-6 text-ink-faint">
            Description provided by the creator. Directory review covers the
            listing; it is not a security audit of the app.
          </p>
          {token ? (
            <section id="token" className="mt-9 scroll-mt-28 rounded-2xl border border-line bg-raised p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="display text-xl">Linked token</h2>
                <span className="rounded-full bg-panel px-3 py-1 text-xs font-medium">
                  {token.chainId === 46630
                    ? "Robinhood testnet"
                    : "Robinhood Chain mainnet"}
                </span>
              </div>
              <p className="mt-5 text-xl font-medium">
                {token.name}{" "}
                <span className="ml-1 text-ink-soft">{token.symbol}</span>
              </p>
              <a
                href={explorerAddressUrl(token.chainId, token.address)}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block break-all font-mono text-xs leading-6 text-hood-deep underline underline-offset-4"
              >
                {token.address} ↗
              </a>
              <dl className="mt-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-faint">Token metadata</dt>
                  <dd className="mt-1">Read from deployed contract</dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Source verification</dt>
                  <dd className="mt-1">
                    {token.sourceVerified
                      ? "Confirmed by chain explorer"
                      : "Not confirmed"}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Supply at check</dt>
                  <dd className="mt-1 break-all font-mono text-xs leading-6">
                    {formatUnits(BigInt(token.totalSupply), token.decimals)}{" "}
                    {token.symbol}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-faint">Observation block</dt>
                  <dd className="mt-1 font-mono">{token.blockNumber}</dd>
                </div>
              </dl>
              <p className="mt-5 text-xs leading-6 text-ink-soft">
                Metadata checked{" "}
                <time dateTime={token.checkedAt}>
                  {token.checkedAt
                    .replace("T", " ")
                    .replace(/\.\d{3}Z$/, " UTC")}
                </time>
                . This records the contract’s response at that block; supply and
                behavior may change.
              </p>
            </section>
          ) : null}
        </section>
        <aside className="h-fit rounded-2xl border border-line bg-panel/40 p-5">
          <h2 className="text-sm font-semibold">App details</h2>
          <dl className="mt-5 space-y-5 text-sm">
            <div>
              <dt className="text-ink-faint">Live address</dt>
              <dd className="mt-1 break-all text-ink">
                {new URL(app.liveUrl).hostname}
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">First listed</dt>
              <dd className="mt-1">
                <time dateTime={app.listedAt}>
                  {new Date(app.listedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </time>
              </dd>
            </div>
            <div>
              <dt className="text-ink-faint">Listing updated</dt>
              <dd className="mt-1">
                <time dateTime={app.updatedAt}>
                  {app.updatedAt.slice(0, 10)}
                </time>
              </dd>
            </div>
          </dl>
          <div className="mt-6 grid gap-2 border-t border-line pt-4">
            <a
              href={`/api/v1/apps/${app.slug}`}
              className="inline-flex min-h-11 items-center text-sm text-hood-deep underline underline-offset-4"
            >
              Read app JSON ↗
            </a>
            <Link
              href="/apps"
              className="inline-flex min-h-11 items-center text-sm text-ink-soft"
            >
              Publish your own app →
            </Link>
          </div>
        </aside>
      </div>
    </DirectoryShell>
  );
}
