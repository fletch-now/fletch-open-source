"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { safeFetch, readBody } from "@/components/dashboard/settings/request";
import { Send } from "@/components/ui/icons";

// Server passes down what it already knows (linked account, whether the bot is
// configured at all) so the first render is honest; this component only takes
// over once the person acts — request a link, open it, unlink.

interface TelegramLinkCardProps {
  configured: boolean;
  linked: boolean;
  linkedUsername: string | null;
}

interface LinkResponse {
  url: string;
  expiresInSeconds: number;
}

export function TelegramLinkCard({ configured, linked, linkedUsername }: TelegramLinkCardProps): React.ReactNode {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<LinkResponse | null>(null);

  async function requestLink(): Promise<void> {
    setPending(true);
    setError(null);
    const response = await safeFetch("/api/telegram/link", { method: "POST" });
    const body = await readBody(response);
    setPending(false);
    if (!response?.ok || typeof body?.url !== "string" || typeof body.expiresInSeconds !== "number") {
      setError(typeof body?.error === "string" ? body.error : "Could not create the link. Try again.");
      return;
    }
    setLink({ url: body.url, expiresInSeconds: body.expiresInSeconds });
  }

  async function unlink(): Promise<void> {
    setPending(true);
    setError(null);
    const response = await safeFetch("/api/telegram/link", { method: "DELETE" });
    const body = await readBody(response);
    setPending(false);
    if (!response?.ok) {
      setError(typeof body?.error === "string" ? body.error : "Could not unlink Telegram. Try again.");
      return;
    }
    setLink(null);
    router.refresh();
  }

  if (linked) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-raised px-5 py-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-hood-wash text-hood-deep">
          <Send className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] text-ink">
            Linked to <span className="break-all font-medium">{linkedUsername ? `@${linkedUsername}` : "your private chat"}</span>
          </p>
          <p className="text-[13px] text-ink-faint">Telegram notifications go to this chat.</p>
        </div>
        <button
          type="button"
          onClick={unlink}
          disabled={pending}
          className="ml-auto flex h-11 items-center rounded-full border border-line px-4 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50"
        >
          Unlink
        </button>
        {error ? <p role="alert" className="w-full text-[13px] text-red-600">{error}</p> : null}
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="rounded-card border border-line bg-raised px-5 py-4">
        <p className="text-[14px] text-ink">Telegram delivery is not configured yet.</p>
        <p className="mt-1 text-[13px] text-ink-faint">
          Watchers record matches in your dashboard. Link a bot to receive Telegram notifications too.
        </p>
      </div>
    );
  }

  if (link) {
    const minutes = Math.round(link.expiresInSeconds / 60);
    return (
      <div className="rounded-card border border-line bg-raised px-5 py-4">
        <p className="text-[14px] text-ink">Open Telegram and send the message it prefills.</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center rounded-full bg-hood px-5 text-[13px] font-semibold text-black transition-colors hover:bg-hood-strong"
          >
            Open Telegram
          </a>
          <button type="button" onClick={function checkLink() { router.refresh(); }} className="min-h-11 text-[13px] underline">Check connection</button>
        </div>
        <p className="mt-3 text-[12.5px] text-ink-faint">Expires in {minutes} minutes.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-raised px-5 py-4">
      <div className="min-w-0">
        <p className="text-[14px] text-ink">Telegram is not linked.</p>
        <p className="text-[13px] text-ink-faint">Matches appear in your dashboard. Telegram is optional.</p>
      </div>
      <button
        type="button"
        onClick={requestLink}
        disabled={pending}
        className="ml-auto flex h-11 items-center rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {pending ? "Starting…" : "Link Telegram"}
      </button>
      {error ? <p className="w-full text-[13px] text-red-600">{error}</p> : null}
    </div>
  );
}
