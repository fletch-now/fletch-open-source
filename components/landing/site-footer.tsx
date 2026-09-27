import Image from "next/image";
import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import { ArrowUpRight, GitBranch } from "@/components/ui/icons";
import { Wordmark } from "@/components/brand/fletch-mark";
import { GITHUB_URL, RH_MAINNET_ID, RH_TESTNET_ID } from "@/lib/config";
import { CommunityLinks } from "@/components/landing/community-links";
import { FltxContract } from "@/components/fltx-contract";

// The footer's black plate. The render lives at the very bottom, dimmed and
// masked so it dissolves upward — the columns and the legal bar read over it
// without a seam, and it only really emerges at the foot of the page.

// The footer's black plate, crowned by the render with a small star field
// drifting over it — the same motes the hero and the closing archer get.

const STARS = [
  { top: "18%", left: "50%", size: 3, duration: "20s", reverse: false, className: "bg-hood shadow-[0_0_8px_rgba(0,200,5,0.8)]" },
  { top: "45%", left: "96%", size: 2, duration: "28s", reverse: true, className: "bg-hood/70 shadow-[0_0_6px_rgba(0,200,5,0.6)]" },
  { top: "70%", left: "40%", size: 3, duration: "23s", reverse: false, className: "bg-white/75 shadow-[0_0_6px_rgba(255,255,255,0.55)]" },
  { top: "30%", left: "6%", size: 2, duration: "32s", reverse: true, className: "bg-hood/60 shadow-[0_0_6px_rgba(0,200,5,0.55)]" },
  { top: "60%", left: "88%", size: 2, duration: "25s", reverse: false, className: "bg-white/60 shadow-[0_0_6px_rgba(255,255,255,0.5)]" },
];

interface FooterLink {
  label: string;
  href: string;
  external?: boolean;
}

const COLUMNS: Array<{ title: string; links: FooterLink[] }> = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#demos" },
      { label: "Live registry", href: "/#registry" },
      { label: "Registry", href: "/registry" },
      { label: "Published apps", href: "/published" },
      { label: "Docs", href: "/docs" },
      { label: "Roadmap", href: "/docs/roadmap" },
      { label: "API reference", href: "/docs/api" },
      { label: "Start a build", href: "/dashboard/build" },
      { label: "Fletch Watch", href: "/#bots" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    title: "Chain",
    links: [
      {
        label: `Mainnet · ${RH_MAINNET_ID}`,
        href: "https://robinhoodchain.blockscout.com",
        external: true,
      },
      {
        label: `Testnet · ${RH_TESTNET_ID}`,
        href: "https://explorer.testnet.chain.robinhood.com",
        external: true,
      },
      { label: "Robinhood Chain docs", href: "https://docs.robinhood.com", external: true },
    ],
  },
  {
    title: "Build",
    links: [
      { label: "Foundry", href: "https://book.getfoundry.sh", external: true },
      { label: "Contract explorer", href: "https://robinhoodchain.blockscout.com", external: true },
      { label: "viem", href: "https://viem.sh", external: true },
    ],
  },
  {
    title: "Open source",
    links: [
      { label: "MCP server", href: `${GITHUB_URL}/fletch-mcp`, external: true },
      { label: "API spec and SDK", href: `${GITHUB_URL}/fletch-api`, external: true },
      { label: "Registry snapshots", href: `${GITHUB_URL}/fletch-registry-data`, external: true },
      { label: "Swagger UI", href: "/api/v1/docs" },
      { label: "llms.txt", href: "/llms.txt" },
      { label: "For agents", href: "/skill.md" },
    ],
  },
];

export function SiteFooter(): ReactElement {
  return (
    <footer className="relative bg-night text-white">
      {/* The render crowns the plate, anchored to its top edge and dissolved
          smoothly into the black by the time the columns begin. */}
      <div className="relative h-[260px] overflow-hidden sm:h-[380px] lg:h-[460px]">
        <Image
          src="/brand/footer-graphic.png"
          alt=""
          fill
          sizes="100vw"
          className="top-5 object-cover object-top"
        />
        {STARS.map(function star(orbit) {
          return (
            <div
              key={`${orbit.top}-${orbit.left}`}
              aria-hidden="true"
              className="absolute inset-0 motion-safe:[animation:orbit-spin_20s_linear_infinite]"
              style={{
                animationDuration: orbit.duration,
                animationDirection: orbit.reverse ? "reverse" : "normal",
              }}
            >
              <span
                className={`absolute rounded-full ${orbit.className}`}
                style={{ top: orbit.top, left: orbit.left, width: orbit.size, height: orbit.size }}
              />
            </div>
          );
        })}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent via-black/25 to-black" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/40" />
      </div>

      <div className="relative z-10 mx-auto w-full max-w-6xl px-5 sm:px-6">
        <div className="grid grid-cols-2 gap-10 py-16 md:grid-cols-7 md:gap-8 lg:py-20">
          <div className="col-span-2">
            <Wordmark />
            <p className="mt-5 max-w-xs text-[13.5px] leading-6 text-white/50">
              Build testnet apps with recorded contract checks. Use Registry to
              inspect token identities and current observations. Watch saves
              matched events in your dashboard, with optional Telegram and webhook delivery.
            </p>
            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.1em] text-white/40">
              Robinhood Chain · {RH_MAINNET_ID} / {RH_TESTNET_ID}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-3.5 py-1.5 text-[13px] text-white transition-colors hover:border-hood hover:text-hood"
            >
              <GitBranch className="h-3.5 w-3.5" strokeWidth={1.8} />
              GitHub
            </a>
            <CommunityLinks />
            </div>
          </div>

          {COLUMNS.map(function renderColumn(column) {
            return (
              <div key={column.title} className="md:col-span-1">
                <h3 className="mb-5 text-[13px] font-medium text-white">{column.title}</h3>
                <ul className="space-y-3.5">
                  {column.links.map(function renderLink(link) {
                    return (
                      <li key={link.label}>
                        <Link
                          href={link.href}
                          target={link.external ? "_blank" : undefined}
                          rel={link.external ? "noreferrer" : undefined}
                          className="group -my-2 inline-flex items-center gap-1.5 py-2 text-[13.5px] text-white/40 transition-colors hover:text-white"
                        >
                          {link.label}
                          <ArrowUpRight
                            className="h-3 w-3 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100"
                            strokeWidth={2}
                          />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="pb-7"><FltxContract dark /></div>
        <div className="flex flex-col gap-3 border-t border-white/10 py-7 text-[12px] text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md">
            Generated apps are unaudited. Fletch deploys builds to testnet {RH_TESTNET_ID}.
            Mainnet deployment is planned.
          </p>
          <p>Independent software. Not affiliated with Robinhood Markets.</p>
        </div>
      </div>
    </footer>
  );
}
