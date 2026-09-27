import type { ReactNode } from "react";
import { CircleAlert, Triangle } from "@/components/ui/icons";

export type NoticeTone = "warn" | "bad" | "info" | "neutral";

export interface NoticeBarProps {
  tone: NoticeTone;
  children: ReactNode;
  action?: ReactNode;
}

interface ToneStyle {
  bg: string;
  border: string;
  text: string;
  icon: (className: string) => ReactNode;
}

const TONE_STYLE: Record<NoticeTone, ToneStyle> = {
  warn: {
    bg: "bg-amber-50",
    border: "border-amber-300/70",
    text: "text-amber-900",
    icon: (className) => <Triangle className={className} strokeWidth={1.8} />,
  },
  bad: {
    bg: "bg-red-50",
    border: "border-red-300/70",
    text: "text-red-900",
    icon: (className) => <CircleAlert className={className} strokeWidth={1.8} />,
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-300/70",
    text: "text-blue-900",
    icon: (className) => <CircleAlert className={className} strokeWidth={1.8} />,
  },
  neutral: {
    bg: "bg-panel",
    border: "border-line",
    text: "text-ink-soft",
    icon: (className) => <CircleAlert className={className} strokeWidth={1.8} />,
  },
};

// The page-top banner: daemon down, RPC fallback, Telegram unlinked. An icon
// carries the tone alongside colour — never colour alone — and `action` is the
// one control that actually fixes it, not a link buried mid-sentence.
export function NoticeBar({ tone, children, action }: NoticeBarProps): ReactNode {
  const style = TONE_STYLE[tone];
  return (
    <div className={`mb-6 flex flex-wrap items-center gap-3 rounded-card border px-5 py-4 ${style.bg} ${style.border}`}>
      {style.icon(`h-4 w-4 shrink-0 ${style.text}`)}
      <p className={`min-w-0 flex-1 text-[13.5px] ${style.text}`}>{children}</p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
