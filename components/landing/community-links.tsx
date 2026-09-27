import { TelegramMark } from "@/components/brand/telegram-mark";
import { GitHubMark, XMark } from "@/components/brand/social-marks";
import { GITHUB_URL, TELEGRAM_URL, X_URL } from "@/lib/config";

interface Props {
  compact?: boolean;
  includeGithub?: boolean;
  tone?: "night" | "light";
}

export function CommunityLinks({ compact = false, includeGithub = false, tone = "night" }: Props): React.JSX.Element {
  const links = [
    { name: "X", href: X_URL, icon: <XMark /> },
    { name: "Telegram", href: TELEGRAM_URL, icon: <TelegramMark size={19} /> },
  ];
  if (includeGithub) links.push({ name: "GitHub", href: GITHUB_URL, icon: <GitHubMark size={20} /> });
  const colour = tone === "night" ? "text-white/75 hover:text-white" : "text-ink-soft hover:text-hood-deep";
  const shape = compact ? "h-11 w-11 justify-center" : "min-h-11 gap-2 rounded-full border border-white/20 px-3.5 text-[13px] hover:border-white/50";
  return <>{links.map(function social(link) {
    return <a key={link.name} href={link.href} target="_blank" rel="noopener noreferrer"
      aria-label={`Fletch on ${link.name} (opens in a new tab)`} title={link.name}
      className={`inline-flex shrink-0 items-center transition-colors focus-visible:rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood ${colour} ${shape}`}>
      {link.icon}{compact ? null : link.name}
    </a>;
  })}</>;
}
