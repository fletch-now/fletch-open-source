import type { ReactElement } from "react";
import { Eyebrow } from "@/components/landing/kit";
import { Separator } from "@/components/new-separator";
import { TelegramMark } from "@/components/brand/telegram-mark";
import { TELEGRAM_URL } from "@/lib/config";

// The Watch strip: one short Telegram-focused note between the demo bands. The
// pipeline visuals live in the dashboard; here a person only needs to know the
// daemon exists and where the alert lands.
export function BotsSection(): ReactElement {
  return (
    <section id="bots" className="relative scroll-mt-16 bg-night text-white">
      <Separator edge="top" />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-5 py-10 sm:px-6 sm:py-12 lg:flex-row lg:items-center lg:justify-between lg:gap-14">
        <div className="max-w-xl">
          <Eyebrow onDark className="mb-4">
            always on
          </Eyebrow>
          <h2 className="display text-balance text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.05] tracking-[-0.02em]">
            Alerts that keep working after you close the tab.
          </h2>
          <p className="mt-3 text-[14.5px] leading-7 text-white/65">
            Choose a supported mainnet token or event in Watch. Matches appear in your dashboard, with optional Telegram or webhook delivery. Each alert includes the recorded event so you can check what triggered it.
          </p>
        </div>
        <div className="shrink-0">
          {TELEGRAM_URL ? (
            <a
              href={TELEGRAM_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center gap-2.5 rounded-full bg-hood px-6 text-[14.5px] font-semibold text-black transition-colors hover:bg-hood-strong"
            >
              <TelegramMark size={16} />
              Join the Fletch Telegram
            </a>
          ) : (
            <span className="inline-flex h-12 items-center gap-2.5 rounded-full border border-white/25 px-6 text-[14.5px] text-white/85">
              <TelegramMark size={16} />
              Telegram channel opening soon
            </span>
          )}
        </div>
      </div>
      <Separator edge="bottom" />
    </section>
  );
}
