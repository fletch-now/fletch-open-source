import { Reveal } from "./reveal";
import { SectionHeader } from "./kit";

const CAPABILITIES = [
  {
    title: "On-Chain Truth Oracle",
    body: "Fletch gives the builder recorded Robinhood Chain addresses, identity checks and market observations. The builder can request relevant data from the registry, with the source and freshness limits attached.",
  },
  {
    title: "Persistence Beyond the Tab",
    body: "Browser builders stop working the second you walk away. Fletch runs a background daemon that reads every block, handles reorgs, and delivers alerts wherever you want them - Telegram, webhooks, your own agent.",
  },
  {
    title: "The Compiler is the Judge",
    body: "Every line compiles before you see it. Fletch runs Foundry test suites inside an isolated sandbox and shows the compiler output and source verification.",
  },
  {
    title: "Zero Infrastructure Overhead",
    body: "You never set up an RPC, a VPS, or a deploy script. Fletch compiles, tests in Foundry, deploys to testnet, and hosts your dApp on a live subdomain.",
  },
];

export function CapabilitiesSection() {
  return (
      <section id="capabilities" className="relative scroll-mt-16 border-t border-line">
        <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-6 lg:py-16">
          <SectionHeader
            centered
            eyebrow="what fletch can do"
            lead="Built for the Chain,"
            trail="not just the prompt."
          />
          <div className="grid gap-px overflow-hidden border border-line bg-line md:grid-cols-2">
            {CAPABILITIES.map(function renderCapability(capability, index) {
              return (
                <Reveal key={capability.title} delayMs={index * 90} className="bg-raised">
                  <div className="group h-full p-7 lg:p-12">
                    <p className="mb-8 font-mono text-[12.5px] text-ink-faint">0{index + 1}</p>
                    <h3 className="display mb-4 text-[24px] leading-tight text-ink transition-transform duration-500 group-hover:translate-x-2 lg:text-[30px]">
                      {capability.title}
                    </h3>
                    <p className="max-w-md text-[15px] leading-8 text-ink-soft">{capability.body}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>
  );
}
