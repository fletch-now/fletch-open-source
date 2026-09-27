import Link from "@/components/ui/navigation-link";
import { PlanCard } from "@/components/landing/plan-card";
import { Reveal } from "@/components/landing/reveal";
import { Check } from "@/components/ui/icons";
import { PLANS, NOTES, PRICING_INTRO } from "@/components/landing/pricing-copy";

export function PlansSection() {
  return (
    <section id="pricing" className="relative scroll-mt-16 border-t border-line">
      <div className="relative mx-auto w-full max-w-7xl px-5 py-14 sm:px-8 lg:py-20">
        <div className="mb-10 max-w-3xl lg:mb-12">
          <span className="mb-4 inline-flex items-center gap-3 font-mono text-[12.5px] text-ink-faint">
            <span aria-hidden="true" className="h-px w-12 bg-ink/30" />
            Pricing · coming soon
          </span>
          <Reveal>
            <h2 className="display text-balance text-[clamp(2.2rem,4.8vw,3.9rem)] leading-[0.95] tracking-tight text-ink">
              Pay for builds.{" "}
              <span style={{ WebkitTextStroke: "1.5px currentColor", WebkitTextFillColor: "transparent" }}>Watch for free.</span>
            </h2>
          </Reveal>
          <p className="mt-4 max-w-2xl text-[15.5px] leading-7 text-ink-soft">
            {PRICING_INTRO}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-0">
          {PLANS.map(function renderPlan(plan, index) {
            return (
              <Reveal key={plan.name} delayMs={index * 100} className={plan.highlight ? "lg:z-10 lg:-mx-2 lg:scale-[1.03]" : ""}>
                <PlanCard plan={plan} tone="light" />
              </Reveal>
            );
          })}
        </div>

        <div className="mt-12 flex flex-col gap-6 border-t border-line pt-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-6 text-[14px] text-ink-soft">
            {NOTES.map(function renderNote(item) {
              return (
                <span key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-hood-deep" strokeWidth={2.2} />
                  {item}
                </span>
              );
            })}
          </div>
          <Link href="/pricing" className="text-[14px] text-ink underline underline-offset-4 hover:text-hood-deep">
            The full pricing page
          </Link>
        </div>
      </div>
    </section>
  );
}
