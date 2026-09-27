import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { SectionHeader, Stat } from "@/components/landing/kit";
import { Reveal } from "@/components/landing/reveal";
import { ArrowUpRight } from "@/components/ui/icons";
import { RH_MAINNET_ID } from "@/lib/config";
import { readPublicRegistryNumbers, registryNumberStats } from "@/lib/registry/public-numbers";

// The home page's account of the registry, with the numbers read from the
// same tables the registry pages read. Every line names something that is
// built and links to where it lives; nothing here is a roadmap.

interface Capability {
  title: string;
  body: string;
  href: string;
}

const CAPABILITIES: Capability[] = [
  { title: "Listed token identities", body: "Robinhood's Stock Token list compared with bytecode and contract metadata. A ticker alone does not establish an issuer relationship.", href: "/registry" },
  { title: "Beacon dependency", body: "Recorded beacon addresses show which implementation a Stock Token depends on. Listing and metadata checks establish the verified identity.", href: "/registry?state=feed" },
  { title: "Multipliers and pauses", body: "The current split multiplier, scheduled changes and pause states, with the time each contract was read.", href: "/registry?state=pending" },
  { title: "Price feeds and history", body: "Recorded Chainlink answers and available round history. A heartbeat check flags old readings.", href: "/registry/TSLA#feed" },
  { title: "Supply reconciliation", body: "Indexed mint and burn events compared with contract supply. Coverage and unexplained differences stay visible.", href: "/registry?state=residual" },
  { title: "Holder observations", body: "Balances derived from indexed transfers, with pool and bridge labels where a match is known. Read the indexed range before treating a total as complete.", href: "/docs/registry-reading" },
  { title: "Markets and pool selection", body: "Compare prices, measured depth and available trading activity. Selected pools and observation times explain each reading.", href: "/registry/markets" },
  { title: "Bridge activity", body: "Recorded deposits and withdrawals through the Arbitrum gateway, with escrow and supply observations.", href: "/registry/WBTC#bridge" },
  { title: "Lookalike tokens", body: "Discovered contracts that share a listed ticker or name. Compare their addresses and recorded identity checks.", href: "/registry/lookalikes" },
  { title: "Issuer documents", body: "Tracked prospectuses and Final Terms, with source links and detected revisions.", href: "/registry/issuer" },
  { title: "Changelog and alerts", body: "Recorded changes in the page, Atom, JSON and live stream. Watchers can deliver matching events to Telegram or a webhook.", href: "/registry/changes" },
  { title: "Freshness and coverage", body: "Job results, observation ages and indexing gaps show what is current and what still needs a reading.", href: "/registry/status" },
];

const AGENT_SURFACES = [
  { label: "JSON, listed assets and recorded state", href: `/api/v1/chains/${RH_MAINNET_ID}/assets` },
  { label: "Changelog as a live stream", href: `/api/v1/chains/${RH_MAINNET_ID}/events/stream` },
  { label: "OpenAPI", href: "/api/v1/openapi.json" },
  { label: "llms.txt", href: "/llms.txt" },
];

export async function RegistryLive(): Promise<ReactElement> {
  const numbers = await readPublicRegistryNumbers();
  const stats = registryNumberStats(numbers).filter(function headline(stat) {
    return stat.label !== "recorded scan matches" && stat.label !== "changes observed in 7 days";
  });

  return (
    <section id="registry" className="relative scroll-mt-16 border-t border-line">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:py-16">
        <SectionHeader
          centered
          eyebrow="live registry"
          lead="Robinhood Chain data"
          trail="with its source and age."
          deck="Fletch checks published token identities against Robinhood Chain and records the evidence. Pages, JSON and feeds expose the observed state with its source, age and coverage limits. The counters below use the registry's own tables."
        />

        <Reveal className="mb-10 grid grid-cols-2 gap-6 sm:grid-cols-4">
          {stats.map(function renderStat(stat) {
            return <Stat key={stat.label} value={stat.value} label={stat.label} />;
          })}
        </Reveal>

        <p className="-mt-5 mb-8 text-center text-[11.5px] leading-5 text-ink-faint">
          {numbers ? <>Reading checked <time dateTime={numbers.checkedAt.toISOString()}>{numbers.checkedAt.toISOString()}</time>. {numbers.summary}</> : "This reading is unavailable; counts will be retried."}{" "}
          <Link href="/registry/status" className="underline underline-offset-4">Source times and coverage</Link>.
        </p>

        <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(function renderCapability(capability, index) {
            return (
              <Reveal key={capability.title} delayMs={(index % 3) * 60}>
                <Link href={capability.href} className="group flex h-full flex-col bg-paper p-5 transition-colors hover:bg-panel/60">
                  <p className="flex items-center gap-2 text-[14.5px] font-medium text-ink">
                    {capability.title}
                    <ArrowUpRight className="h-3.5 w-3.5 text-ink-faint transition-colors group-hover:text-hood-deep" strokeWidth={1.8} />
                  </p>
                  <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">{capability.body}</p>
                </Link>
              </Reveal>
            );
          })}
        </div>

        <Reveal className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px]">
          <Link href="/registry" className="inline-flex items-center gap-2 font-medium text-hood-deep underline-offset-4 hover:underline">
            Browse the live registry
            <ArrowUpRight className="h-4 w-4" strokeWidth={1.8} />
          </Link>
          <span className="text-ink-faint">for agents:</span>
          {AGENT_SURFACES.map(function renderSurface(surface) {
            return (
              <a key={surface.href} href={surface.href} className="text-ink-soft underline underline-offset-4 hover:text-ink">
                {surface.label}
              </a>
            );
          })}
          <a href="https://github.com/fletch-now/fletch-mcp" target="_blank" rel="noreferrer" className="text-[12.5px] underline underline-offset-4 hover:text-ink">
            MCP server, on GitHub
          </a>
        </Reveal>
      </div>
    </section>
  );
}
