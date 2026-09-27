import { connection } from "next/server";
import { db } from "@/lib/db";
import { activePricing } from "@/lib/build/pricing-quotes";
import type { ReactElement } from "react";
import { publicPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "@/components/ui/navigation-link";
import { SiteHeader } from "@/components/ui/site-header";
import { SiteFooter } from "@/components/landing/site-footer";
import { SITE_NAV_LINKS } from "@/components/landing/nav-links";
import { Reveal } from "@/components/landing/reveal";
import { Check } from "@/components/ui/icons";
import { PlanCard } from "@/components/landing/plan-card";
import { PLANS, NOTES, PRICING_INTRO } from "@/components/landing/pricing-copy";

export const metadata: Metadata = publicPageMetadata("/pricing");

export default async function PricingPage(): Promise<ReactElement> {
  await connection();
  const published = await db.transaction(activePricing);
  return (
    <div className="relative flex flex-1 flex-col">
      <SiteHeader links={SITE_NAV_LINKS} tone="light" />

      <main className="mx-auto w-full max-w-7xl px-5 pb-24 pt-28 sm:px-8 lg:pt-36">
        <div className="mb-16 grid gap-8 lg:mb-20 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <span className="mb-8 inline-flex items-center gap-3 font-mono text-[12.5px] text-ink-faint">
              <span aria-hidden="true" className="h-px w-12 bg-ink/30" />
              pricing
            </span>
            <Reveal>
              <h1 className="display text-[clamp(3rem,9vw,7.5rem)] leading-[0.9] tracking-tight text-ink">
                Pay for builds.
                <br />
                <span style={{ WebkitTextStroke: "1.5px currentColor", WebkitTextFillColor: "transparent" }}>Watch for free.</span>
              </h1>
            </Reveal>
            <p className="mt-8 max-w-xl text-[17px] leading-8 text-ink-soft">
              {PRICING_INTRO}
            </p>
          </div>
          <div className="relative h-72 sm:h-96 lg:col-span-5 lg:h-auto">
            <Image
              src="/brand/archer.webp"
              alt=""
              fill
              sizes="(min-width: 1024px) 40vw, 90vw"
              className="object-contain object-center"
              priority
            />
          </div>
        </div>

        {published ? <section className="mb-12" aria-label="Current build packages">
          <h2 className="text-2xl font-medium text-ink">Current testnet build packages</h2>
          <p className="mt-3 text-sm text-ink">Review the fixed credit price before starting. The included allowance may not finish every brief. More work requires another explicit approval. BYOK costs zero Fletch credits; your provider bills separately.</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">{(["small", "medium", "large"] as const).map(function card(tier) { const pack = published.policy.tiers[tier];return <article key={tier} className="rounded-2xl border border-line p-5 text-ink"><h3 className="text-lg font-medium capitalize">{tier}</h3><p className="mt-2 text-2xl">{pack.credits} credits</p><p className="mt-3 text-sm">{pack.allowance.modelRequests} model requests · {pack.allowance.toolRuns} platform tool runs · {pack.allowance.activeSeconds} seconds of active work</p><Link className="mt-4 inline-block underline" href="/dashboard/build">Review a build</Link></article>; })}</div>
          <p className="mt-3 text-sm text-ink">Success costs the accepted package price. Failure or Stop releases all reserved credits. Existing accepted builds keep their original terms.</p>
        </section> : null}
        <div className="grid gap-4 lg:grid-cols-3 lg:gap-0">
          {PLANS.map(function renderPlan(plan, index) {
            return (
              <Reveal key={plan.name} delayMs={index * 100} className={plan.highlight ? "lg:z-10 lg:-mx-2 lg:scale-[1.03]" : ""}>
                <PlanCard plan={plan} tone="light" />
              </Reveal>
            );
          })}
        </div>

        <div className="mt-20 flex flex-col gap-8 border-t border-line pt-12 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-6 text-[14px] text-ink-soft">
            {NOTES.map(function renderGuarantee(item) {
              return (
                <span key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-hood-deep" strokeWidth={2.2} />
                  {item}
                </span>
              );
            })}
          </div>
          <Link href="/registry" className="text-[14px] underline underline-offset-4 hover:text-hood-deep">
            See what you can watch
          </Link>
        </div>

        <p className="mt-12 text-[14px] leading-7 text-ink-soft">
          <Link href="/docs/limits" className="underline underline-offset-4 hover:text-hood-deep">Current limits, checkout availability and planned features</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
