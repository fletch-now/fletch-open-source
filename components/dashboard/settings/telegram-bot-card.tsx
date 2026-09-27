"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { safeFetch, readBody } from "@/components/dashboard/settings/request";
import { Check } from "@/components/ui/icons";

interface TelegramBotCardProps {
  bot: { username: string; createdAt: string } | null;
  linkedUsername: string | null;
  linked: boolean;
}

interface Feedback {
  tone: "ok" | "error";
  text: string;
}

export function TelegramBotCard({ bot, linkedUsername, linked }: TelegramBotCardProps): React.ReactNode {
  const router = useRouter();
  const [link, setLink] = useState<{ token: string; url: string } | null>(null);
  const [token, setToken] = useState("");
  const [pending, setPending] = useState<"save" | "link" | "remove" | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  async function save(): Promise<void> {
    setPending("save");
    setFeedback(null);
    const response = await fetch("/api/telegram/bot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(function ignore() {
      return null;
    });
    const body = await response?.json().catch(function ignore() {
      return null;
    });
    setPending(null);
    if (!response?.ok || typeof body?.bot?.username !== "string") {
      setFeedback({ tone: "error", text: typeof body?.error === "string" ? body.error : "Could not save the token." });
      return;
    }
    setToken("");
    setFeedback({ tone: "ok", text: `Bot @${body.bot.username} saved. Create a private link below to connect your chat.` });
    router.refresh();
  }

  async function linkChat(): Promise<void> {
    setPending("link");
    setFeedback(null);
    const response = await safeFetch("/api/telegram/bot/link", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(link ? { token: link.token } : { action: "prepare" }),
    });
    const body = await readBody(response);
    setPending(null);
    if (!response?.ok || !body) {
      setFeedback({ tone: "error", text: typeof body?.error === "string" ? body.error : "Could not connect Telegram. Try again." });
      return;
    }
    if (!link) {
      if (typeof body.token !== "string" || typeof body.url !== "string") {
        setFeedback({ tone: "error", text: "Could not create the private link. Try again." });
        return;
      }
      setLink({ token: body.token, url: body.url });
      return;
    }
    setLink(null);
    setFeedback({ tone: "ok", text: "Chat linked. Telegram notifications are enabled; matches stay in your dashboard." });
    router.refresh();
  }

  async function remove(): Promise<void> {
    if (!window.confirm("Remove your bot? Telegram notifications will pause. Recorded matches stay in your dashboard.")) return;
    setPending("remove");
    setFeedback(null);
    const response = await safeFetch("/api/telegram/bot", { method: "DELETE" });
    const body = await readBody(response);
    setPending(null);
    if (!response?.ok) {
      setFeedback({ tone: "error", text: typeof body?.error === "string" ? body.error : "Could not remove the bot. Try again." });
      return;
    }
    setLink(null);
    router.refresh();
  }

  let linkLabel = "Create private link";
  if (link) linkLabel = "Finish linking";
  if (pending === "link") linkLabel = "Checking…";

  const step1Done = Boolean(bot);
  const step2Done = step1Done && linked;

  return (
    <div className="rounded-card border border-line bg-raised">
      <ol className="divide-y divide-line">
        <li className="flex gap-4 px-5 py-4">
          <StepMark done={step1Done} number={1} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink">Create a bot and paste its token</p>
            <p className="mt-1 text-[13px] leading-6 text-ink-soft">
              Open{" "}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-ink">
                @BotFather
              </a>
              , send <span className="font-mono">/newbot</span>, give it a name, and copy the token it replies with. It
              looks like <span className="font-mono">123456789:AAH…</span>
            </p>
            {bot ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
                <span className="text-ink">
                  Using <span className="font-medium">@{bot.username}</span>
                </span>
                <button
                  type="button"
                  onClick={remove}
                  disabled={pending !== null}
                  className="min-h-11 text-red-700 underline underline-offset-4 disabled:opacity-50"
                >
                  Remove bot
                </button>
              </div>
            ) : (
              <form
                onSubmit={function onSubmit(event) {
                  event.preventDefault();
                  void save();
                }}
                className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
              >
                <input
                  aria-label="Telegram bot token"
                  type="password"
                  value={token}
                  onChange={function onChange(event) {
                    setToken(event.target.value);
                  }}
                  placeholder="Paste the token"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-11 min-h-11 min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 font-mono text-base sm:text-[13px] text-ink placeholder:font-sans placeholder:text-ink-faint focus:border-hood/60 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={pending !== null || token.trim().length < 20}
                  className="h-11 rounded-full bg-ink px-5 text-[13px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {pending === "save" ? "Checking…" : "Save token"}
                </button>
              </form>
            )}
          </div>
        </li>

        <li className="flex gap-4 px-5 py-4">
          <StepMark done={step2Done} number={2} />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink">Connect your private chat</p>
            <p className="mt-1 text-[13px] leading-6 text-ink-soft">
              Create a private link, open it in Telegram and press Start. Then return here to finish linking. The link expires after 15 minutes.
            </p>
            {link ? (
              <a href={link.url} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-4 text-[13px] text-ink">
                Open private Telegram link
              </a>
            ) : null}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" onClick={linkChat} disabled={!bot || pending !== null}
                className="min-h-11 rounded-full bg-hood px-5 py-2 text-[13px] font-semibold text-black hover:bg-hood-strong disabled:opacity-50">
                {linkLabel}
              </button>
              {link ? <button type="button" onClick={function resetLink() { setLink(null); setFeedback(null); }} disabled={pending !== null} className="min-h-11 text-[13px] underline">Start again</button> : null}
              {linked ? (
                <span className="text-[13px] text-ink-soft">
                  Linked{linkedUsername ? ` to @${linkedUsername}` : ""}. Telegram notifications go here.
                </span>
              ) : null}
            </div>
          </div>
        </li>
      </ol>
      {feedback ? (
        <p className={`border-t border-line px-5 py-3 text-[13px] ${feedback.tone === "ok" ? "text-hood-deep" : "text-red-700"}`} role="status">
          {feedback.text}
        </p>
      ) : null}
    </div>
  );
}

interface StepMarkProps {
  done: boolean;
  number: number;
}

function StepMark({ done, number }: StepMarkProps): React.ReactNode {
  if (done) {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-hood text-black">
        <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line font-mono text-[12px] text-ink-soft">
      {number}
    </span>
  );
}
