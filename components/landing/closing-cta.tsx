import type { ReactElement } from "react";
import Link from "@/components/ui/navigation-link";
import Image from "next/image";
import { STARTER_CREDITS, RH_TESTNET_ID } from "@/lib/config";

// The final ask: one oversized question on the left, the robin archer grounded
// on the right, and a square frame drawn just inside the plate — no rounded
// ring, no band-edge rules — so the section matches nothing else on the page.
// The archer stands still; the only motion is a small star field orbiting it.

const STARS = [
  { top: "4%", left: "50%", size: 3, duration: "19s", reverse: false, className: "bg-hood shadow-[0_0_8px_rgba(0,200,5,0.8)]" },
  { top: "50%", left: "97%", size: 2, duration: "27s", reverse: true, className: "bg-hood/70 shadow-[0_0_6px_rgba(0,200,5,0.6)]" },
  { top: "88%", left: "42%", size: 3, duration: "22s", reverse: false, className: "bg-white/70 shadow-[0_0_6px_rgba(255,255,255,0.5)]" },
  { top: "30%", left: "3%", size: 2, duration: "31s", reverse: true, className: "bg-hood/60 shadow-[0_0_6px_rgba(0,200,5,0.55)]" },
  { top: "66%", left: "92%", size: 2, duration: "24s", reverse: false, className: "bg-white/60 shadow-[0_0_6px_rgba(255,255,255,0.45)]" },
];

export function ClosingCta(): ReactElement {
  return (
    <section id="start" className="relative overflow-hidden bg-night text-white">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-4 border border-white/15 sm:inset-6 lg:inset-8"
      />
      <div className="relative z-10 mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-20 sm:px-6 sm:py-24 lg:grid-cols-2 lg:gap-16 lg:py-32">
        <div>
          <p className="mb-4 font-mono text-xs text-zinc-500">Start here</p>
          <h2 className="display text-balance text-[clamp(2.2rem,5.2vw,4.4rem)] leading-[0.95] tracking-[-0.02em] text-white">
            Build your first app on testnet.
          </h2>
          <p className="mb-8 mt-6 max-w-lg text-[15px] leading-relaxed text-zinc-400">
            Sign in with a new wallet address to receive {STARTER_CREDITS} free build credit. A failed compile refunds its platform credit. Watchers record matches in your dashboard; Telegram and webhooks are optional notifications. Use the platform model or connect your own model API key.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Link
              href="/dashboard/build"
              className="inline-flex items-center justify-center rounded-full bg-[#00FF66] px-6 py-3 text-[14.5px] font-semibold text-black transition-colors hover:bg-[#00e65c]"
            >
              Open Build →
            </Link>
            <Link
              href="/docs"
              className="inline-flex items-center justify-center rounded-full border border-zinc-800 px-6 py-3 text-[14.5px] font-medium text-white transition-colors hover:border-zinc-700"
            >
              Read docs
            </Link>
          </div>
          <p className="mt-6 font-mono text-xs text-zinc-500">
            Wallet sign-in, no card, testnet {RH_TESTNET_ID}
          </p>
        </div>

        <div
          className="relative mx-auto w-full max-w-[520px] translate-y-4 sm:translate-y-6 lg:ml-auto lg:translate-y-8"
          aria-hidden="true"
        >
          <div className="pointer-events-none absolute left-1/2 top-[6%] h-[42%] w-[72%] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(0,255,102,0.15),transparent)] blur-[100px]" />
          {STARS.map(function star(orbit) {
            return (
              <div
                key={`${orbit.top}-${orbit.left}`}
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
          <Image
            src="/brand/final-robin-archer.png"
            alt=""
            width={1165}
            height={1350}
            sizes="(min-width: 1024px) 520px, 85vw"
            className="relative h-auto w-full select-none"
          />
        </div>
      </div>
    </section>
  );
}
