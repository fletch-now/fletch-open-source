"use client";

import Link from "@/components/ui/navigation-link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WebhookEndpointRow } from "@/lib/watch/webhooks";
import { formatWhen } from "@/components/dashboard/settings/format";
import { readBody, safeFetch } from "@/components/dashboard/settings/request";
import { Check, Copy } from "@/components/ui/icons";

interface AssignedWatcher {
  id: string;
  name: string;
  webhookId: string | null;
  enabled: boolean;
}

interface WebhooksCardProps {
  webhooks: WebhookEndpointRow[];
  watchers?: AssignedWatcher[];
}

interface RevealedSecret {
  id: string;
  name: string;
  secret: string;
}

interface TestResult {
  id: string;
  ok: boolean;
  message: string;
}

const BUTTON = "inline-flex min-h-11 items-center justify-center rounded-full border border-line px-4 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-50";

function responseError(body: Record<string, unknown> | null, fallback: string): string {
  return typeof body?.error === "string" ? body.error : fallback;
}

function readSecret(body: Record<string, unknown> | null): RevealedSecret | null {
  const value = body?.webhook;
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.secret !== "string") return null;
  return { id: row.id, name: row.name, secret: row.secret };
}

function attemptLabel(at: Date | null, status: number | null, error: string | null): string {
  if (!at) return "No attempt recorded";
  const when = formatWhen(at);
  if (error) return `${error} · ${when}`;
  if (status !== null && status >= 200 && status < 300) return `Accepted (HTTP ${status}) · ${when}`;
  return `No acknowledgement · ${when}`;
}

export function WebhooksCard({ webhooks, watchers = [] }: WebhooksCardProps): React.ReactNode {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [copied, setCopied] = useState(false);
  const [tested, setTested] = useState<TestResult | null>(null);
  const busy = pending !== null;

  function replaceSecret(next: RevealedSecret): void {
    setRevealed(next);
    setCopied(false);
  }

  function canReplaceSecret(): boolean {
    return !revealed || window.confirm(`Have you saved the signing secret for "${revealed.name}"? Continuing replaces the secret shown here.`);
  }

  async function create(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !canReplaceSecret()) return;
    setPending("create");
    setError(null);
    const response = await safeFetch("/api/v1/webhooks", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.trim(), name: name.trim() || undefined }),
    });
    const body = await readBody(response);
    setPending(null);
    if (!response?.ok) {
      setError(responseError(body, "Couldn't add that endpoint. Check Settings before trying again."));
      return;
    }
    const created = readSecret(body);
    if (!created) {
      setError("The endpoint response was incomplete. Refresh Settings and rotate its secret if it was created.");
      return;
    }
    replaceSecret(created);
    setUrl("");
    setName("");
    router.refresh();
  }

  async function sendTest(id: string): Promise<void> {
    setPending(`test:${id}`);
    setError(null);
    setTested(null);
    const response = await safeFetch(`/api/v1/webhooks/${id}/test`, { method: "POST" });
    const body = await readBody(response);
    setPending(null);
    const ok = response?.ok === true && body?.ok === true && typeof body.status === "number" && body.status >= 200 && body.status < 300;
    const message = ok ? `Connection test accepted (HTTP ${body?.status}). Check watcher history for matching events.` : responseError(body, "The connection test failed. Try again after checking your endpoint.");
    setTested({ id, ok, message });
    router.refresh();
  }

  async function change(webhook: WebhookEndpointRow, action: "toggle" | "rotate" | "delete"): Promise<void> {
    const count = watchers.filter((watcher) => watcher.webhookId === webhook.id).length;
    let question = `Delete "${webhook.name}"? Its ${count} assigned watchers will be paused and queued notifications will fail. Recorded matches stay in the dashboard.`;
    if (action === "toggle") question = `Disable "${webhook.name}"? Its running watchers will pause and queued notifications will wait. A request already in progress may finish.`;
    if (action === "rotate") question = `Replace the signing secret for "${webhook.name}"? Update your receiver immediately; the old secret will stop verifying new requests.`;
    if (action === "rotate" && !canReplaceSecret()) return;
    if ((action !== "toggle" || webhook.enabled) && !window.confirm(question)) return;
    setPending(`${action}:${webhook.id}`);
    setError(null);
    const options: RequestInit = { method: "DELETE" };
    if (action !== "delete") {
      options.method = "PATCH";
      options.headers = { "content-type": "application/json" };
      options.body = JSON.stringify(action === "rotate" ? { rotateSecret: true } : { enabled: !webhook.enabled });
    }
    const response = await safeFetch(`/api/v1/webhooks/${webhook.id}`, options);
    const body = await readBody(response);
    setPending(null);
    if (!response?.ok) { setError(responseError(body, "Couldn't save that change. Refresh to check the endpoint's current state.")); return; }
    if (action === "rotate") {
      const next = readSecret(body);
      if (!next) { setError("The new secret was not received. Rotate it again before using this endpoint."); return; }
      replaceSecret(next);
    }
    if (action === "delete" && revealed?.id === webhook.id) setRevealed(null);
    setTested(null);
    router.refresh();
  }

  async function copySecret(secret: string): Promise<void> {
    try { await navigator.clipboard.writeText(secret); setCopied(true); }
    catch { setError("Clipboard access is unavailable. Select and copy the signing secret above."); }
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-card border border-line bg-raised" aria-labelledby="webhooks-heading">
      <div className="border-b border-line px-5 py-4">
        <h2 id="webhooks-heading" className="text-[14px] font-medium text-ink">Webhooks</h2>
        <p className="mt-1 text-[13px] leading-5 text-ink-soft">Send watcher matches to your app as signed JSON. Every match also stays in your dashboard.</p>
        <ol className="mt-3 list-inside list-decimal space-y-1 text-[12.5px] leading-5 text-ink-faint">
          <li>Add your HTTPS endpoint and save its signing secret.</li>
          <li>Verify signatures in your receiver, then send a connection test.</li>
          <li>Assign a watcher to choose which events it receives.</li>
        </ol>
      </div>
      {error ? <p role="alert" className="mx-5 mt-4 rounded-md bg-red-50 p-3 text-[13px] text-red-700">{error}</p> : null}
      {revealed ? (
        <div className="mx-5 my-4 rounded-card border border-hood-deep/30 bg-hood-wash p-4">
          <p className="break-words text-[13.5px] font-medium text-ink">Signing secret for {revealed.name}</p>
          <p className="mt-1 text-[12.5px] leading-5 text-ink-soft">Save this now. It is shown once. Your receiver uses it to verify notifications.</p>
          <div className="mt-2 flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-raised p-3 font-mono text-[12px] text-ink">{revealed.secret}</code>
            <button type="button" onClick={() => void copySecret(revealed.secret)} aria-label={copied ? "Secret copied" : "Copy signing secret"} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line">
              {copied ? <Check className="h-4 w-4 text-hood-deep" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button type="button" onClick={() => setRevealed(null)} className="mt-2 min-h-11 text-[12.5px] text-ink-soft underline underline-offset-4">I saved it. Hide secret</button>
        </div>
      ) : null}
      <ul className="divide-y divide-line">
        {webhooks.map(function renderEndpoint(webhook): React.ReactNode {
          const assigned = watchers.filter((watcher) => watcher.webhookId === webhook.id);
          return (
            <li key={webhook.id} className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 break-words text-[14px] font-medium text-ink">{webhook.name}</h3>
                <span className="rounded-full bg-panel px-2.5 py-1 text-[11px] text-ink-soft">{webhook.enabled ? "Enabled" : "Disabled"}</span>
              </div>
              <p className="break-all font-mono text-[12px] text-ink-faint">{webhook.url}</p>
              <dl className="space-y-2 rounded-lg bg-panel/60 p-3 text-[12.5px] leading-5">
                <div><dt className="font-medium text-ink">Connection test</dt><dd className={webhook.lastTestError ? "text-red-700" : "text-ink-soft"}>{attemptLabel(webhook.lastTestAt, webhook.lastTestStatus, webhook.lastTestError)}</dd></div>
                <div><dt className="font-medium text-ink">Latest watcher alert attempt</dt><dd className={webhook.lastAlertError ? "text-red-700" : "text-ink-soft"}>{attemptLabel(webhook.lastAlertAt, webhook.lastAlertStatus, webhook.lastAlertError)}</dd></div>
              </dl>
              {!webhook.enabled ? <p className="text-[12.5px] leading-5 text-ink-soft">Enable this endpoint to resume the watchers it paused and send queued notifications. Watchers you paused yourself stay paused.</p> : null}
              <div>
                <p className="text-[12.5px] font-medium text-ink">{assigned.length} assigned {assigned.length === 1 ? "watcher" : "watchers"}</p>
                {assigned.length === 0 ? <p className="mt-1 text-[12.5px] text-ink-faint">Choose this endpoint in a new or existing watcher&apos;s notification settings.</p> : (
                  <ul className="mt-1">{assigned.map((watcher) => <li key={watcher.id}><Link href={`/dashboard/watch/${watcher.id}`} className="inline-flex min-h-11 items-center text-[13px] text-ink-soft underline underline-offset-4">{watcher.name} · {watcher.enabled ? "running" : "paused"}</Link></li>)}</ul>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  {webhook.enabled ? <Link href={`/dashboard/watch/new?webhook=${encodeURIComponent(webhook.id)}`} className={BUTTON}>Create watcher</Link> : null}
                  <Link href="/dashboard/watch" className={BUTTON}>Manage watchers</Link>
                </div>
              </div>
              {tested?.id === webhook.id ? <p role="status" className={`text-[12.5px] leading-5 ${tested.ok ? "text-hood-deep" : "text-red-700"}`}>{tested.message}</p> : null}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void sendTest(webhook.id)} disabled={busy || !webhook.enabled} className={BUTTON}>{pending === `test:${webhook.id}` ? "Testing connection…" : "Send connection test"}</button>
                <button type="button" onClick={() => void change(webhook, "toggle")} disabled={busy} className={BUTTON}>{webhook.enabled ? "Disable" : "Enable"}</button>
              </div>
              <details className="text-[12.5px] text-ink-faint">
                <summary className="min-h-11 cursor-pointer py-3">Signing secret and endpoint removal</summary>
                <p className="mb-2 font-mono">Secret: {webhook.secretPrefix}…</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy} onClick={() => void change(webhook, "rotate")} className={BUTTON}>Rotate secret</button>
                  <button type="button" disabled={busy} onClick={() => void change(webhook, "delete")} className={`${BUTTON} text-red-700`}>Delete endpoint</button>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      <form onSubmit={create} className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <h3 className="text-[13px] font-medium text-ink">Add endpoint</h3>
        <label className="text-[12.5px] text-ink-soft">Endpoint URL<input type="url" required maxLength={2048} autoComplete="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/fletch" className="mt-1 h-11 w-full min-w-0 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong" /></label>
        <label className="text-[12.5px] text-ink-soft">Name (optional)<input type="text" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="Production alerts" className="mt-1 h-11 w-full min-w-0 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong" /></label>
        <button type="submit" disabled={busy} className="flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-[13.5px] font-medium text-paper disabled:opacity-50 sm:self-start">{pending === "create" ? "Adding…" : "Add endpoint"}</button>
      </form>
      <details className="border-t border-line px-5 py-3 text-[12.5px] leading-5 text-ink-faint">
        <summary className="min-h-11 cursor-pointer py-3 text-ink-soft">Developer setup and delivery behavior</summary>
        <p className="pb-3">Verify <code className="break-all">X-Fletch-Signature</code> against the raw request body using HMAC-SHA256 over <code>&lt;t&gt;.&lt;body&gt;</code>. Compare in constant time and reject timestamps older than five minutes. Return HTTP 2xx within 10 seconds. Failed alerts retry up to 8 attempts; process each delivery ID once.</p>
        <p className="pb-3">A connection test sends a signed ping with no watcher. An accepted response confirms your endpoint answered; check your receiver&apos;s logs to confirm signature verification and event processing. Alert results are recorded separately. Separate test and alert history starts with this release.</p>
        <Link href="/docs/webhooks" className="inline-flex min-h-11 items-center underline underline-offset-4">Webhook guide and code examples</Link>
        <a href="/llms.txt" className="ml-4 inline-flex min-h-11 items-center underline underline-offset-4">Agent guide</a>
      </details>
    </section>
  );
}
