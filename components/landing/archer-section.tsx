import Link from "@/components/ui/navigation-link";
import { ArrowRight } from "@/components/ui/icons";
import { LiveDataFlow } from "@/components/landing/live-data-flow";
import { Separator } from "@/components/new-separator";
import { RH_MAINNET_ID } from "@/lib/config";

// The chain, and Fletch's place on it: a night section with the live data shown
// working on the right (blocks in, checks, chart and alert out) and the three
// facts a person building here needs first. A one-pixel grey seam marks each edge.

const FACTS = [
  {
    title: "Stock Tokens, on chain",
    body: "Tokenised stocks trade around the clock on Robinhood Chain. Each one is an ERC-20 contract with an address Fletch has checked against the chain itself.",
  },
  {
    title: "A block every 100 milliseconds",
    body: "Fast enough that a page can read live state and a watcher can act in the same second a transfer lands. Fletch's daemon reads every block.",
  },
  {
    title: "Newer than the models",
    body: "AI coding tools guess at this chain. Fletch hands them a verified map first, and publishes the same map for any agent to read.",
  },
];

export function ArcherSection() {
  return (
    <section id="chain" className="relative bg-night text-white">
      <Separator edge="top" />
      <div className="mx-auto grid w-full max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-12 lg:gap-16 lg:py-32">
        <div className="lg:col-span-6">
          <span className="mb-6 inline-flex items-center gap-3 font-mono text-[12.5px] text-white/60">
            <span aria-hidden="true" className="h-px w-12 bg-white/30" />
            Robinhood Chain · {RH_MAINNET_ID}
          </span>
          <h2 className="display max-w-xl text-balance text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.95] tracking-[-0.02em]">
            Every verified live current data,
            <span className="block text-white/45">ready-made for your data</span>
          </h2>
          <ul className="mt-10 grid gap-6 sm:grid-cols-3 lg:grid-cols-1 lg:gap-5">
            {FACTS.map(function renderFact(fact, index) {
              return (
                <li key={fact.title} className="flex gap-4">
                  <span className="font-mono text-[12px] text-white/40">0{index + 1}</span>
                  <div>
                    <p className="text-[16px] font-medium text-white">{fact.title}</p>
                    <p className="mt-1 text-[15px] leading-6 text-white/65">{fact.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          <Link
            href="/registry"
            className="group mt-10 inline-flex h-12 items-center gap-2 rounded-full bg-hood px-6 text-[14.5px] font-semibold text-black transition-colors hover:bg-hood-strong"
          >
            Browse every token
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={2.2} />
          </Link>
        </div>

        <div className="flex lg:col-span-6 lg:justify-end" aria-hidden="true">
          <LiveDataFlow />
        </div>
      </div>
      <Separator edge="bottom" />
    </section>
  );
}
