import type { ReactElement, ReactNode } from "react";
import { ConnectionBand } from "@/components/landing/brand-bands";
import { Separator } from "@/components/new-separator";
import { Reveal } from "@/components/landing/reveal";
import { FletchMark } from "@/components/brand/fletch-mark";
import { Blocks, FileJson, Hammer } from "@/components/ui/icons";
import {
  AnthropicLogo,
  CursorLogo,
  RobinhoodLogo,
  SlackDiscordLogo,
  TelegramLogo,
  WebhookGlyph,
} from "@/components/brand/integration-logos";

// The integrations band: everything the worker talks to, in one grid. The header
// sits low over the hands render; the cards are the reference's square plates —
// sharp corners, a border and no fill, a bare mark, and an underline that draws
// itself on hover. Cards tagged "soon" describe planned integrations.

interface Integration {
  logo: ReactNode;
  name: string;
  badge: string;
  sub: string;
  soon?: boolean;
}

const INTEGRATIONS: Integration[] = [
  { logo: <AnthropicLogo size={20} />, name: "Claude Code", badge: "LLM", sub: "Verified Stock Tokens, queried over MCP." },
  { logo: <CursorLogo size={20} />, name: "Cursor", badge: "IDE", sub: "Fletch's CLI skill in your workspace.", soon: true },
  { logo: <Hammer className="h-5 w-5" strokeWidth={1.8} />, name: "Foundry", badge: "Compiler", sub: "Compilation and sandboxed test suites." },
  { logo: <TelegramLogo size={20} />, name: "Telegram", badge: "Comms", sub: "Watcher alerts delivered to your linked chat." },
  { logo: <Blocks className="h-5 w-5" strokeWidth={1.8} />, name: "Chain explorer", badge: "Explorer", sub: "Source verification attempts after deployment." },
  { logo: <RobinhoodLogo size={20} />, name: "Robinhood Chain", badge: "Network", sub: "Mainnet data and testnet app deployment." },
  { logo: <FletchMark size={18} className="text-hood" />, name: "Fletch MCP", badge: "Protocol", sub: "Registry reads over MCP, from GitHub." },
  { logo: <span className="font-mono text-[15px]">{"{ }"}</span>, name: "JSON Endpoints", badge: "Data", sub: "Token records with provenance and reading times." },
  { logo: <WebhookGlyph size={20} />, name: "Custom Webhooks", badge: "Devs", sub: "Signed watcher events with delivery retries." },
  { logo: <FileJson className="h-5 w-5" strokeWidth={1.8} />, name: "llms.txt", badge: "Agent", sub: "A chain map for any LLM's context." },
  { logo: <span className="font-mono text-[17px]">$</span>, name: "USDG", badge: "Payments", sub: "Credit purchases signed from your wallet.", soon: true },
  { logo: <SlackDiscordLogo size={20} />, name: "Webhook Routers", badge: "Alerts", sub: "Alerts to Slack and Discord channels.", soon: true },
];

export function ConnectionInterlude(): ReactElement {
  return (
    <section id="interlude" className="relative bg-night text-white">
      <Separator edge="top" />
      <div className="relative pt-20 sm:pt-24 lg:pt-32 pb-12 sm:pb-16 lg:pb-20">
        <div className="relative z-10 mx-auto max-w-3xl px-5 text-center sm:px-8">
          <span className="mb-5 inline-flex items-center gap-3 font-mono text-[12.5px] text-white/60">
            <span aria-hidden="true" className="h-px w-12 bg-white/30" />
            integrations
            <span aria-hidden="true" className="h-px w-12 bg-white/30" />
          </span>
          <h2 className="display text-balance text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.95] tracking-[-0.02em]">
            Use Fletch from your own tools.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16px] leading-7 text-white/65">
            Connect your model API key for builds or a webhook for alerts. Developers can read Registry data through the JSON API and MCP server, with OpenAPI and an agent skill to describe the interfaces.
          </p>
        </div>

        <div className="relative -mt-4 sm:-mt-16 lg:-mt-28">
          <ConnectionBand />
        </div>

        <div className="relative mx-auto mt-3 grid max-w-6xl grid-cols-1 gap-3 px-5 sm:mt-4 sm:grid-cols-2 sm:px-8 lg:grid-cols-4">
          {INTEGRATIONS.map(function renderCard(card, index) {
            return (
              <Reveal key={card.name} delayMs={index * 40}>
                <div className="group relative h-full overflow-hidden border border-white/10 p-5 transition-colors duration-500 hover:border-white/30 sm:p-6">
                  <span className="absolute right-3 top-3 bg-white/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-white/50 transition-colors group-hover:bg-hood/20 group-hover:text-hood">
                    {card.badge}
                  </span>
                  <div className="mb-5 flex h-10 w-10 items-center justify-center text-white/70">
                    {card.logo}
                  </div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-[15px] font-medium text-white">{card.name}</h3>
                    {card.soon ? (
                      <span className="shrink-0 rounded-full border border-hood/40 bg-hood-wash px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-hood">
                        soon
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[12px] leading-5 text-white/45">{card.sub}</p>
                  <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-white/10">
                    <span className="block h-full w-0 bg-hood transition-all duration-500 group-hover:w-full" />
                  </span>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
      <Separator edge="bottom" />
    </section>
  );
}
