import Link from "@/components/ui/navigation-link";
import { TrajectoryArc, Wordmark } from "@/components/brand/fletch-mark";

// Site-wide 404. Next renders this one for any unmatched URL, so it carries the
// marketing chrome rather than the app shell, and it lists every place a person
// could have been trying to reach.

const PLACES = [
  {
    heading: "The site",
    links: [
      { href: "/", label: "Home" },
      { href: "/#templates", label: "What you can make" },
      { href: "/#bots", label: "Alerts on Telegram" },
      { href: "/registry", label: "Registry of tokens on Robinhood Chain" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    heading: "The dashboard",
    links: [
      { href: "/dashboard", label: "Overview" },
      { href: "/dashboard/build", label: "Build an app" },
      { href: "/dashboard/projects", label: "Your projects" },
      { href: "/dashboard/watch", label: "Watchers" },
      { href: "/dashboard/alerts", label: "Alerts" },
      { href: "/dashboard/registry", label: "Registry of Stock Tokens" },
      { href: "/dashboard/settings", label: "Settings, Telegram, API keys" },
    ],
  },
  {
    heading: "For scripts and agents",
    links: [
      { href: "/api/v1/openapi.json", label: "OpenAPI document" },
      { href: "/api/v1/chains", label: "Chains endpoint" },
      { href: "/api/v1/chains/4663/assets", label: "Verified assets on chain 4663" },
    ],
  },
];

export default function NotFound() {
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      <div className="bg-rings pointer-events-none absolute inset-0" />
      <TrajectoryArc className="pointer-events-none absolute left-1/2 top-16 h-[220px] w-[1200px] max-w-none -translate-x-1/2 text-hood/20" />

      <header className="relative px-5 pt-6">
        <Link href="/" className="inline-block">
          <Wordmark />
        </Link>
      </header>

      <main className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-16 sm:py-24">
        <p className="mono-label mb-5">error 404</p>
        <h1 className="display text-balance text-[clamp(2rem,6vw,3.4rem)] text-ink">That arrow missed.</h1>
        <p className="mt-4 max-w-md text-pretty text-[15px] leading-7 text-ink-soft">
          There is no page at this address. It may have moved, or the link may have a typo.
          Everything on Fletch is one click from here.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            href="/"
            className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90"
          >
            Back home
          </Link>
          <Link
            href="/dashboard/build"
            className="rounded-full border border-line px-5 py-2.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
          >
            Start a build
          </Link>
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
          {PLACES.map(function renderGroup(group) {
            return (
              <div key={group.heading} className="bg-raised p-6">
                <p className="mono-label mb-4">{group.heading}</p>
                <ul className="flex flex-col gap-2.5">
                  {group.links.map(function renderLink(link) {
                    return (
                      <li key={link.href}>
                        <Link href={link.href} className="text-[14px] text-ink underline-offset-4 hover:text-hood-deep hover:underline">
                          {link.label}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
