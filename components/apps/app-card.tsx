import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import type { PublicApp } from "@/lib/apps/types";
import { appHue } from "@/lib/apps/presentation";
import { explorerAddressUrl } from "@/lib/chain/explorer";

interface Props {
  app: PublicApp;
}

export function AppCard({ app }: Props): ReactElement {
  const hue = appHue(app.slug);
  const token = app.token;
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-raised transition-colors hover:border-hood-deep">
      <Link
        href={`/published/${app.slug}`}
        className="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-hood-deep"
      >
        <div
          className="relative flex h-36 items-center justify-center overflow-hidden border-b border-line"
          style={{ background: token ? "#080e0b" : `hsl(${hue} 35% 92%)` }}
          aria-hidden="true"
        >
          <span
            className={`absolute h-56 w-56 translate-x-24 translate-y-14 rounded-full border-[30px] motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:translate-x-20 ${token ? "border-hood/10" : "border-white/35"}`}
          />
          <span className="absolute h-32 w-32 -translate-x-28 -translate-y-14 rounded-full border border-black/5" />
          <span
            className={`display relative max-w-full truncate px-5 tracking-tight ${token ? "text-4xl" : "text-6xl"}`}
            style={{ color: token ? "#00e006" : `hsl(${hue} 40% 25%)` }}
          >
            {token
              ? `$${token.symbol}`
              : app.title.trim().slice(0, 1).toUpperCase()}
          </span>
          {token ? (
            <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 font-mono text-[10px] text-white/80">
              {token.chainId === 46630 ? "TESTNET" : "MAINNET"}
            </span>
          ) : null}
          {app.featured ? (
            <span className="absolute bottom-3 left-4 rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide text-ink">
              Featured by Fletch
            </span>
          ) : null}
        </div>
        <div className="flex flex-1 flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="display break-words text-xl leading-7 text-ink">
              {app.title}
            </h2>
            <span
              aria-hidden="true"
              className="text-lg text-ink-faint transition-colors group-hover:text-hood-deep"
            >
              ↗
            </span>
          </div>
          <p className="mt-2 line-clamp-3 text-sm leading-6 text-ink-soft">
            {app.summary}
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5 text-[11px] text-ink-faint">
            {app.token ? (
              <span className="rounded-full border border-line px-2 py-1 text-ink-soft">
                ${app.token.symbol} ·{" "}
                {app.token.chainId === 46630 ? "Testnet" : "Mainnet"}
              </span>
            ) : (
              <span>Web app</span>
            )}
            <time dateTime={app.listedAt}>
              {new Date(app.listedAt).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}
            </time>
          </div>
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t border-line p-3">
        <a
          href={app.liveUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-hood px-3 text-sm font-semibold text-black transition-colors hover:bg-hood-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood-deep"
        >
          Open app ↗
        </a>
        {token ? (
          <Link
            href={`/published/${app.slug}#token`}
            className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-3 text-sm font-medium hover:bg-panel"
          >
            Token details
          </Link>
        ) : (
          <Link
            href={`/published/${app.slug}`}
            className="inline-flex min-h-11 items-center rounded-xl border border-line-strong px-3 text-sm font-medium hover:bg-panel"
          >
            About app
          </Link>
        )}
        {token ? (
          <a
            href={explorerAddressUrl(token.chainId, token.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 w-full items-center justify-between gap-2 px-1 font-mono text-[11px] text-ink-soft underline underline-offset-4"
            aria-label={`View ${token.symbol} contract on the chain explorer`}
          >
            <span>
              {token.address.slice(0, 8)}…{token.address.slice(-6)}
            </span>
            <span>Contract ↗</span>
          </a>
        ) : null}
      </div>
    </article>
  );
}
