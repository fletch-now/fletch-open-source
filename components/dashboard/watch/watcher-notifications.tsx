"use client";

import Link from "@/components/ui/navigation-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readBody, safeFetch } from "@/components/dashboard/settings/request";

interface WatcherNotificationsProps {
  watcherId: string;
  webhookId: string | null;
  delivery: "telegram" | "webhook";
  webhooks: { id: string; name: string; enabled: boolean }[];
}

export function WatcherNotifications({ watcherId, webhookId, delivery, webhooks }: WatcherNotificationsProps): React.ReactNode {
  const router = useRouter();
  const current = delivery === "webhook" ? webhookId ?? "deleted" : "";
  const [selected, setSelected] = useState(current);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = selected === "" || webhooks.some((webhook) => webhook.id === selected && webhook.enabled);

  async function save(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid || pending) return;
    setPending(true);
    setMessage(null);
    setError(null);
    const response = await safeFetch(`/api/v1/watchers/${watcherId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ webhookId: selected || null }),
    });
    const body = await readBody(response);
    setPending(false);
    if (!response?.ok) { setError(typeof body?.error === "string" ? body.error : "Couldn't save the notification channel. Try again."); return; }
    setMessage("Notification channel saved. Queued notifications use this channel. Resume a paused watcher to check for new matches.");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="mb-6 rounded-card border border-line bg-raised p-4 sm:p-5">
      <h2 className="text-[14px] font-medium text-ink">Notifications</h2>
      <p className="mt-1 text-[13px] leading-5 text-ink-soft">Matches are saved in your dashboard. Choose where to send notifications too.</p>
      <div className="mt-3 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-[12.5px] text-ink-soft">Notification channel
          <select value={selected} disabled={pending} onChange={(event) => { setSelected(event.target.value); setMessage(null); }} className="mt-1 h-11 w-full min-w-0 rounded-md border border-line bg-raised px-3 text-base text-ink sm:text-sm">
            <option value="">Telegram (requires a linked chat)</option>
            {current === "deleted" ? <option value="deleted" disabled>Previous endpoint was deleted</option> : null}
            {webhooks.map((webhook) => <option key={webhook.id} value={webhook.id} disabled={!webhook.enabled}>{webhook.name} (webhook){webhook.enabled ? "" : " · disabled"}</option>)}
          </select>
        </label>
        <button type="submit" disabled={pending || !valid || selected === current} className="min-h-11 shrink-0 rounded-full bg-ink px-5 text-[13px] font-medium text-paper disabled:opacity-50">{pending ? "Saving…" : "Save channel"}</button>
      </div>
      <p className="mt-3 text-[12.5px] leading-5 text-ink-faint">The new channel applies to future matches and queued notifications. Choosing a new webhook also queues held matches from the last 24 hours. A request already in progress may finish at the previous endpoint.</p>
      <Link href="/dashboard/settings#webhooks" className="mt-1 inline-flex min-h-11 items-center text-[12.5px] text-ink-soft underline underline-offset-4">Manage endpoints and connection tests</Link>
      {error ? <p role="alert" className="text-[13px] text-red-700">{error}</p> : null}
      {message ? <p role="status" className="text-[13px] text-hood-deep">{message}</p> : null}
    </form>
  );
}
