// Telegram Bot API client. No `server-only` here — the watch daemon
// (workers/watch.ts, a plain `tsx` process) delivers alerts through
// sendTelegramMessage, and `server-only` would throw outside Next.js.

import { redactSecrets } from "@/lib/redact";

const TELEGRAM_API_BASE = "https://api.telegram.org";
const SEND_TIMEOUT_MS = 10_000;

function botToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN ?? "";
}

export function telegramBotUsername(): string {
  return process.env.TELEGRAM_BOT_USERNAME ?? "";
}

export function telegramConfigured(): boolean {
  return botToken().length > 0 && telegramBotUsername().length > 0 && Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);
}

// HTML parse mode only requires these three escaped; Fletch never sends attributes
// or quoted strings inside tags, so `"` is left alone.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type SendResult = { ok: true } | { ok: false; retryAfterMs?: number; blocked?: boolean; error: string };

interface TelegramApiResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

async function parseJson(response: Response): Promise<TelegramApiResponse | null> {
  return response.json().catch(function notJson(): null {
    return null;
  });
}

// Telegram always sends `description` on failure, but parseJson can hand back
// null (body wasn't JSON at all), so every call site needs a fallback anyway.
function apiErrorMessage(body: TelegramApiResponse | null, fallback: string): string {
  return body?.description ?? fallback;
}

// A person's own bot (lib/telegram/bots.ts) is used when `token` is given; the
// platform bot otherwise. The token lives only in the request URL, built here and
// never returned or logged — callers must not log this function's request, only
// its result.
export async function sendTelegramMessage(chatId: string, html: string, token = botToken()): Promise<SendResult> {
  if (!token) {
    return { ok: false, error: "Telegram is not configured" };
  }

  const controller = new AbortController();
  const timer = setTimeout(function onTimeout(): void {
    controller.abort();
  }, SEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });
    const body = await parseJson(response);

    if (response.ok && body?.ok === true) {
      return { ok: true };
    }
    if (response.status === 429) {
      const retryAfterSeconds = body?.parameters?.retry_after;
      return {
        ok: false,
        retryAfterMs: typeof retryAfterSeconds === "number" ? retryAfterSeconds * 1000 : undefined,
        error: apiErrorMessage(body, "Rate limited by Telegram"),
      };
    }
    if (response.status === 403) {
      // Telegram returns 403 both for "bot was blocked by the user" and "chat not
      // found" — both mean this chat can never receive another message.
      return { ok: false, blocked: true, error: apiErrorMessage(body, "Bot blocked or chat not found") };
    }
    return { ok: false, error: apiErrorMessage(body, `Telegram API error ${response.status}`) };
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") {
      return { ok: false, error: "Telegram request timed out" };
    }
    return { ok: false, error: redactSecrets(cause instanceof Error ? cause.message : String(cause)).replaceAll(token, "[redacted]") };
  } finally {
    clearTimeout(timer);
  }
}

// One-time CLI registration — see app/api/webhooks/telegram/route.ts's header
// comment for the exact curl command that should call this in production.
export async function setWebhook(url: string, secret: string): Promise<SendResult> {
  const token = botToken();
  if (!token) {
    return { ok: false, error: "Telegram is not configured" };
  }
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret }),
  });
  const body = await parseJson(response);
  if (response.ok && body?.ok) {
    return { ok: true };
  }
  return { ok: false, error: apiErrorMessage(body, `setWebhook failed (${response.status})`) };
}

export interface BotIdentity {
  id: string;
  username: string;
}

// Validates a pasted token by asking Telegram who it belongs to. The token is
// only ever placed in the URL of this one request.
export async function getBotIdentity(token: string): Promise<BotIdentity | null> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`, { signal: AbortSignal.timeout(SEND_TIMEOUT_MS) }).catch(
    function unreachable() {
      return null;
    },
  );
  if (!response?.ok) {
    return null;
  }
  const body = (await parseJson(response)) as (TelegramApiResponse & { result?: { id?: number; username?: string } }) | null;
  if (!body?.ok || !body.result?.id || !body.result.username) {
    return null;
  }
  return { id: String(body.result.id), username: body.result.username };
}

export interface PrivateChatUpdate {
  chatId: string;
  username: string | null;
  text: string;
  date: number;
}

interface RawUpdate {
  message?: {
    date?: number;
    text?: string;
    chat?: { id?: number; type?: string; username?: string };
  };
}

// Read without removing webhooks or acknowledging another integration's updates.
export async function recentPrivateChats(token: string): Promise<PrivateChatUpdate[]> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getUpdates?limit=100&allowed_updates=%5B%22message%22%5D`, {
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  }).catch(function unreachable() {
    return null;
  });
  if (!response?.ok) throw new Error("Telegram updates unavailable");
  const body = (await parseJson(response)) as (TelegramApiResponse & { result?: RawUpdate[] }) | null;
  if (!body?.ok || !Array.isArray(body.result)) throw new Error("Telegram updates invalid");
  const updates = body.result;
  return updates
    .map(function shape(update): PrivateChatUpdate | null {
      const message = update.message;
      if (!message?.chat?.id || message.chat.type !== "private") {
        return null;
      }
      return {
        chatId: String(message.chat.id),
        username: message.chat.username ?? null,
        text: message.text ?? "",
        date: message.date ?? 0,
      };
    })
    .filter(function present(item): item is PrivateChatUpdate {
      return item !== null;
    })
    .sort(function newestFirst(a, b) {
      return b.date - a.date;
    });
}
