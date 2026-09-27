import { Suspense, type ReactElement } from "react";
import { connection } from "next/server";
import Link from "@/components/ui/navigation-link";
import { ArrowUpRight } from "@/components/ui/icons";
import { listLatestPublicApps } from "@/lib/apps/directory";
import { RH_TESTNET_ID } from "@/lib/config";
import type { PublicApp } from "@/lib/apps/types";

async function LatestApps(): Promise<ReactElement> {
  // Consent must be read for this request, including after an owner withdraws.
  await connection();
  let apps: PublicApp[];
  try {
    apps = await listLatestPublicApps();
  } catch {
    return <p className="mt-7 text-sm text-ink-soft">App listings could not be loaded. <Link href="/published" className="underline underline-offset-4">Try the directory</Link>.</p>;
  }
  if (apps.length === 0) {
    return <p className="mt-7 rounded-xl border border-dashed border-line-strong p-6 text-sm text-ink-soft">Submitted apps appear here after their owners choose to make them public and a review is complete.</p>;
  }
  return (
    <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {apps.map(function appCard(app) {
        return (
          <article key={app.slug} className="min-w-0 rounded-xl border border-line bg-raised p-5 transition-colors hover:border-hood/50">
            <h3 className="display truncate text-[19px] text-ink">{app.title}</h3>
            {app.token && <p className="mt-2 break-words font-mono text-[11px] text-hood-deep">${app.token.symbol} · {app.token.chainId === RH_TESTNET_ID ? "Testnet" : `Chain ${app.token.chainId}`}</p>}
            <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-ink-soft">{app.summary}</p>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[12px]">
              <time dateTime={app.listedAt} className="font-mono text-ink-faint">{new Date(app.listedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</time>
              <Link href={`/published/${app.slug}`} className="font-semibold text-hood-deep underline underline-offset-4">View app ↗</Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function UserApps(): ReactElement {
  return (
    <section id="user-apps" className="border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-6 lg:py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="display text-[clamp(1.75rem,3vw,2.5rem)]">Apps built by users</h2>
            <p className="mt-2 max-w-xl text-[14px] leading-6 text-ink-soft">The latest apps their owners submitted to the public beta directory. Open a listing for its live link and recorded contract details.</p>
          </div>
          <Link href="/published" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong px-4 text-[13px] font-medium hover:bg-panel">Browse all apps <ArrowUpRight className="h-4 w-4" strokeWidth={1.7} /></Link>
        </div>
        <Suspense fallback={<p role="status" className="mt-7 min-h-32 text-sm text-ink-soft motion-safe:animate-pulse">Loading public apps…</p>}>
          <LatestApps />
        </Suspense>
      </div>
    </section>
  );
}
