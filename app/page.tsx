import type { Metadata } from "next";
import type { ReactElement } from "react";
import { PUBLIC_BUILD_PROMPTS } from "@/lib/build/public-prompts";
import { applicationJsonLd, organizationJsonLd, websiteJsonLd, publicPageMetadata } from "@/lib/seo";
import { AgentChat } from "@/components/chat/agent-chat";
import { HeroSection } from "@/components/ui/hero-section";
import Link from "@/components/ui/navigation-link";
import { HeroFigure } from "@/components/landing/hero-figure";
import { ArrowUpRight, ChevronRight } from "@/components/ui/icons";
import { FootageBand } from "@/components/landing/footage-band";
import { Reveal } from "@/components/landing/reveal";
import { SectionHeader } from "@/components/landing/kit";
import { PlansSection } from "@/components/landing/plans-section";
import { AgentFlow } from "@/components/landing/agent-flow";
import { ChainRegistryPanel } from "@/components/landing/chain-registry-demo";
import { BotsSection } from "@/components/landing/bots-section";
import { BuildDemos } from "@/components/landing/build-demos";
import { OracleSection } from "@/components/landing/oracle-section";
import { DefiDemos } from "@/components/landing/defi-demos";
import { ClosingCta } from "@/components/landing/closing-cta";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/ui/site-header";
import { SITE_NAV_LINKS } from "@/components/landing/nav-links";
import { RH_MAINNET_ID } from "@/lib/config";
import { ConnectionInterlude } from "@/components/landing/connection-interlude";
import { RegistryLive } from "@/components/landing/registry-live";
import { CapabilitiesSection } from "@/components/landing/capabilities-section";

// The agent-native channels from the plan. Each is described by what it would let
// an agent do, and the block that renders them is labelled as unshipped.
const REASONS = [
  {
    title: "Your agent has never seen this chain",
    body: "Claude Code, Cursor, Cline, and the agent in your editor write solid Solidity, but Robinhood Chain is newer than their training data. They can use the wrong chain ID or explorer. Fletch hands the agent the verified registry before it writes a line, so the chain id and the explorer are right from the start.",
  },
  {
    title: "A chat window cannot run the compiler",
    body: "A chat window hands you Solidity nobody has run. Fletch compiles yours with Foundry in a locked-down sandbox, runs the tests, and sends each compiler error back to the agent to fix. You see the compiler's verdict on the finished code, with every test and its gas cost next to it.",
  },
];

const homeMetadata = publicPageMetadata("/");
const description = "Build apps on Robinhood Chain testnet with recorded toolchain checks. Find token identities and market data in Registry, and follow mainnet events with Watch.";
export const metadata: Metadata = {
  ...homeMetadata,
  description,
  openGraph: { ...homeMetadata.openGraph, description },
  twitter: { ...homeMetadata.twitter, description },
};

// Sections held back from the page for now; flip to show them again.
const SHOW_FOOTAGE_BAND = false;
const SHOW_WHY_SECTION = false;

// Public app consent is checked per request in its streamed section. Registry
// aggregates have a separate bounded read cache.
export const revalidate = 0;

export default function Home(): ReactElement {
  return (
    <div className="relative flex flex-1 flex-col overflow-x-clip">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify([organizationJsonLd(), websiteJsonLd(), applicationJsonLd()]) }}
      />
      {/* Floating glass bar: the rings and bloom show through it, which is what
          makes the material read as glass rather than a flat translucent panel. */}
      <SiteHeader links={SITE_NAV_LINKS} />

      {/* The console is the product, so it sits above the fold. The hero is a
          night band that resolves into the paper page at .horizon — its last
          pixel row is literal paper, so the next section's border-t needs no
          change. Layers stack by DOM order; adding a z-index would reorder them. */}
      <HeroSection>
        {/* Sits on the ridge line; the header watches it to know which side of the
            fold the glass pill is on. */}
        <span id="hero-seam" aria-hidden="true" className="absolute inset-x-0 bottom-[150px] h-px sm:bottom-[190px] lg:bottom-[220px]" />

        <div className="pointer-events-none absolute inset-0 hidden lg:block">
          <HeroFigure />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-7xl px-5 pb-16 pt-28 sm:px-8 sm:pb-20 lg:pb-24 lg:pt-36">
          <div className="rise max-w-2xl">
            <p className="mb-5 inline-flex items-center gap-3 font-mono text-[12.5px] text-white/60">
              <span aria-hidden="true" className="h-px w-12 bg-white/30" />
              Robinhood Chain · {RH_MAINNET_ID}
            </p>
            <h1 className="display max-w-2xl text-balance text-[clamp(2.1875rem,4.55vw,4.0875rem)] leading-[1] text-white">
              Build on Robinhood Chain. Fletch verifies it.
            </h1>
            <p className="mt-4 max-w-lg text-[clamp(1.0625rem,1.35vw,1.2225rem)] leading-relaxed text-[#b7c6a2]">
              Describe the dapp. Fletch writes the contract and the page, compiles it,
              tests it, and hosts it. It is the source of truth for Robinhood Chain:
              live blocks, APIs, and verified contract addresses. Close the tab. Your app keeps running.
            </p>

            <p className="mt-3 text-sm text-[#b7c6a2]">No VPS, no RPC keys.</p>

            <div className="mt-7 max-w-xl">
              <AgentChat mode="launcher" launcherPrompts={PUBLIC_BUILD_PROMPTS} />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-[#e8e4da]">
              <Link href="/dashboard/build" className="inline-flex min-h-11 items-center gap-2 rounded-full bg-hood px-5 font-medium text-black transition-colors hover:bg-hood-strong">
                <ArrowUpRight className="h-4 w-4" strokeWidth={1.7} />
                Build
              </Link>
              <Link href="/registry" className="inline-flex min-h-11 items-center rounded-full border border-white/30 px-5 font-medium text-white transition-colors hover:bg-white/10">
                Registry
              </Link>
              <span aria-hidden="true" className="hidden h-5 w-px bg-white/20 sm:block" />
              <Link href="/developers" className="inline-flex min-h-11 items-center gap-2 text-[#e8e4da]/80 hover:text-white focus-visible:outline-2 focus-visible:outline-hood">
                <ChevronRight className="h-4 w-4" strokeWidth={1.7} />
                <span className="font-mono text-[14px]">API &amp; developer tools</span>
              </Link>
            </div>
            <p className="mt-2 text-sm text-white/60">
              <a href="/skill.md" className="inline-flex min-h-11 items-center gap-2 underline underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-hood">
                For agents <span aria-hidden="true">↗</span>
              </a>
              <span className="ml-3">API instructions in Markdown</span>
            </p>
          </div>

          <div className="mt-16 sm:mt-20 lg:hidden">
            <HeroFigure />
          </div>
        </div>

      </HeroSection>

      <CapabilitiesSection />

      <BuildDemos />


      <OracleSection />


      <DefiDemos />


      <BotsSection />


      <RegistryLive />

      <ConnectionInterlude />

      <PlansSection />

      {SHOW_FOOTAGE_BAND ? <FootageBand /> : null}

      {SHOW_WHY_SECTION ? (
      <section id="why" className="scroll-mt-16 border-t border-line bg-panel/50">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-6 lg:py-20">
          <SectionHeader
            eyebrow="why fletch"
            lead="Bring your own agent."
            trail="We know the chain."
            deck="Fletch adds the two things your coding agent lacks on Robinhood Chain. It hands over a current, verified map of the network, then compiles and tests what the agent wrote before you see it."
            aside={<ChainRegistryPanel />}
          />

          <Reveal className="mb-14">
            <AgentFlow />
          </Reveal>

          <div className="grid gap-px overflow-hidden border border-line bg-line md:grid-cols-2">
            {REASONS.map(function renderReason(reason, index) {
              return (
                <Reveal key={reason.title} delayMs={index * 90} className="bg-raised">
                  <div className="group h-full p-7 lg:p-12">
                    <p className="mb-8 font-mono text-[12.5px] text-ink-faint">0{index + 1}</p>
                    <h3 className="display mb-4 text-[24px] leading-tight text-ink transition-transform duration-500 group-hover:translate-x-2 lg:text-[30px]">
                      {reason.title}
                    </h3>
                    <p className="max-w-md text-[15px] leading-8 text-ink-soft">{reason.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>

        </div>
      </section>
      ) : null}


      <ClosingCta />

      <SiteFooter />

    </div>
  );
}
