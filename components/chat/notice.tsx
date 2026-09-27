"use client";

import type { ReactNode } from "react";
import { Vane } from "@/components/brand/fletch-mark";

export type NoticeTone = "error" | "info";

const TONES: Record<NoticeTone, string> = {
  error: "border-amber-300/70 bg-amber-50 text-amber-900",
  info: "border-line bg-panel/60 text-ink-soft",
};

const MARKS: Record<NoticeTone, string> = {
  error: "text-amber-500",
  info: "text-hood/70",
};

interface NoticeProps {
  tone?: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
}

// One notice used for every non-prose message in the console: failures, sign-in
// prompts, capacity limits. Smaller than body text so it reads as chrome.
export function Notice({ tone = "info", children, action }: NoticeProps) {
  // inline-flex so the badge hugs its text instead of spanning the card
  return (
    <span
      className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] leading-5 ${TONES[tone]}`}
    >
      <Vane className={`shrink-0 ${MARKS[tone]}`} />
      <span className="min-w-0">{children}</span>
      {action}
    </span>
  );
}
