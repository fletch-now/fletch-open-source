import type { Metadata } from "next";
import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { DirectoryShell } from "@/components/apps/directory-shell";
import { AppCard } from "@/components/apps/app-card";
import { listPublicApps } from "@/lib/apps/directory";
import { directoryQuery } from "@/lib/apps/validation";
import { canonical, pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  searchParams,
}: PageProps<"/published">): Promise<Metadata> {
  const params = await searchParams;
  const query = directoryQuery(new URLSearchParams(Object.entries(params).filter((row): row is [string, string] => typeof row[1] === "string")));
  const metadata = pageMetadata(
    "/published",
    `Apps built with Fletch${query.page > 1 ? `, page ${query.page}` : ""}`,
    "Explore apps their creators have published with Fletch. Read how each app works and check recorded token details in the beta directory.",
    !query.q,
  );
  const path = query.page > 1 && !query.q ? `/published?page=${query.page}` : "/published";
  metadata.alternates = { ...metadata.alternates, canonical: canonical(path) };
  if (metadata.openGraph) metadata.openGraph.url = canonical(path);
  return metadata;
}

export default async function PublishedPage({
  searchParams,
}: PageProps<"/published">): Promise<ReactElement> {
  const params = await searchParams;
  const query = directoryQuery(
    new URLSearchParams(
      Object.entries(params).filter(function strings(item): item is [
        string,
        string,
      ] {
        return typeof item[1] === "string";
      }),
    ),
  );
  const result = await listPublicApps(query.q, query.page);
  function pageHref(page: number): string {
    const next = new URLSearchParams({ page: String(page) });
    if (query.q) next.set("q", query.q);
    return `/published?${next}`;
  }
  const schema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Apps built with Fletch",
    url: canonical("/published"),
    mainEntity: {
      "@type": "ItemList",
      itemListElement: result.apps.map(function entry(app, index) {
        return {
          "@type": "ListItem",
          position: (query.page - 1) * 24 + index + 1,
          name: app.title,
          url: canonical(`/published/${app.slug}`),
        };
      }),
    },
  };
  return (
    <DirectoryShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(schema).replaceAll("<", "\\u003c"),
        }}
      />
      <header className="relative mb-6 flex flex-wrap items-end justify-between gap-5 overflow-hidden rounded-2xl border border-night-line bg-night p-5 text-white sm:p-7">
        <div className="max-w-2xl">
          <p className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-hood">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-hood" /> App directory · Beta
          </p>
          <h1 className="display text-balance text-[clamp(2rem,5vw,3rem)] leading-[1.08] tracking-tight">
            Apps with a ticker. And without.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-white/75">
            Try what people are shipping. Open an app, meet its token and check
            the contract. Testnet tokens are labelled on every card.
          </p>
        </div>
        <Link
          href="/apps"
          className="inline-flex min-h-11 items-center gap-3 rounded-full bg-hood px-5 text-sm font-semibold text-black hover:bg-hood-strong"
        >
          Add your app <span aria-hidden="true">↗</span>
        </Link>
      </header>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <form
          action="/published"
          className="flex w-full max-w-md gap-2"
          role="search"
        >
          <label htmlFor="app-search" className="sr-only">
            Search apps
          </label>
          <input
            id="app-search"
            name="q"
            defaultValue={query.q}
            maxLength={80}
            placeholder="Search apps, tickers or ideas"
            className="min-h-11 min-w-0 flex-1 rounded-full border border-line-strong bg-raised px-4 text-sm outline-none focus:border-hood-deep focus:ring-2 focus:ring-hood/20"
          />
          <button className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-medium hover:bg-panel">
            Search
          </button>
        </form>
        <div className="flex items-center gap-4 text-xs text-ink-soft">
          <span>Featured, then recently listed</span>
          <a
            href="/api/v1/apps"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center font-mono underline underline-offset-4"
          >
            JSON ↗
          </a>
        </div>
      </div>
      {query.q ? (
        <p className="mb-5 text-sm text-ink-soft">
          Results for “{query.q}”{" "}
          <Link href="/published" className="ml-3 text-hood-deep underline">
            Clear search
          </Link>
        </p>
      ) : null}
      {result.apps.length ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {result.apps.map(function card(app) {
            return <AppCard key={app.slug} app={app} />;
          })}
        </div>
      ) : (
        <section className="rounded-2xl border border-dashed border-line-strong bg-panel/40 px-6 py-14 text-center">
          <h2 className="display text-2xl">
            {query.q
              ? "No matching apps yet"
              : "The directory is open for submissions"}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-7 text-ink-soft">
            {query.q
              ? "Try a shorter name or a different description."
              : "Publish your app, write its introduction and submit it from your project page. Approved listings will appear here."}
          </p>
          <Link
            href="/dashboard/projects"
            className="mt-6 inline-flex min-h-11 items-center rounded-full bg-hood px-5 text-sm font-semibold text-ink"
          >
            Open your projects
          </Link>
        </section>
      )}
      {query.page > 1 || result.hasMore ? (
        <nav
          aria-label="Directory pages"
          className="mt-8 flex items-center justify-between gap-4 border-t border-line pt-5"
        >
          {query.page > 1 ? (
            <Link
              href={pageHref(query.page - 1)}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-sm text-ink-soft">Page {query.page}</span>
          {result.hasMore ? (
            <Link
              href={pageHref(query.page + 1)}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      <p className="mt-8 max-w-3xl text-xs leading-6 text-ink-faint">
        Descriptions are provided by app creators and reviewed for the
        directory. A listing or token metadata check does not establish an app’s
        security. Check the network and transaction before using a wallet.
      </p>
    </DirectoryShell>
  );
}
