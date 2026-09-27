"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { defaultModel, type ProviderId } from "@/lib/agent/selection";
import { modelKeyStatus } from "@/lib/agent/key-status";

export interface StoredKeyView {
  id: string;
  validationStatus: string;
  provider: ProviderId;
  model: string | null;
  custodyMode: "hosted" | "gateway";
}
interface Props { keys: StoredKeyView[] }
interface Feedback { ok: boolean; text: string }
interface KeyResponse {
  ok: boolean;
  error?: string;
  keys?: StoredKeyView[];
  validationStatus?: string;
}

function subscribeHydration(): () => void { return function unsubscribe(): void {}; }
function clientReady(): boolean { return true; }
function serverReady(): boolean { return false; }

const PROVIDERS: Record<ProviderId, { name: string; url: string }> = {
  openai: { name: "OpenAI", url: "https://platform.openai.com/api-keys" },
  anthropic: { name: "Anthropic", url: "https://console.anthropic.com/settings/keys" },
  kimi: { name: "Kimi", url: "https://platform.moonshot.ai/console/api-keys" },
};

async function keyRequest(path: string, method: string, body?: object): Promise<KeyResponse> {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(25_000),
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  const data = await response?.json().catch(() => null);
  if (!response?.ok) return { ok: false, error: data?.error ?? "Could not update this connection. Try again." };
  return { ...data, ok: true };
}

function connectionStatus(key: StoredKeyView): string {
  if (key.custodyMode === "gateway") return `Local gateway · ${key.validationStatus}`;
  return modelKeyStatus(key.validationStatus);
}

export function ModelKeyCard({ keys }: Props): React.ReactElement {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribeHydration, clientReady, serverReady);
  const [provider, setProvider] = useState<ProviderId>("kimi");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const replacing = keys.some((key) => key.provider === provider && key.custodyMode === "hosted");
  const disabled = !hydrated || pending !== null;

  async function save(): Promise<void> {
    if (disabled) return;
    setPending("save");
    setFeedback(null);
    const saved = await keyRequest("/api/model-keys", "POST", {
      custodyMode: "hosted", provider, apiKey: apiKey.trim(), model: model.trim() || undefined,
    });
    if (!saved.ok) {
      setFeedback({ ok: false, text: saved.error! });
      setPending(null);
      return;
    }
    setApiKey("");
    const key = saved.keys?.find((entry) => entry.provider === provider && entry.custodyMode === "hosted");
    let text = "Key saved. Choose it in Build to use 0 Fletch credits.";
    let accessible = false;
    if (key) {
      const checked = await keyRequest("/api/model-keys", "PATCH", { action: "validate", credentialId: key.id });
      accessible = checked.ok && checked.validationStatus === "accessible";
      if (accessible) text = "Key saved and model access checked. Choose Use in Build below to select it.";
      else text = `Key saved. ${checked.error ?? modelKeyStatus(checked.validationStatus ?? "unavailable")}`;
    }
    setFeedback({ ok: accessible, text });
    setPending(null);
    router.refresh();
  }

  async function check(key: StoredKeyView): Promise<void> {
    setPending(key.id);
    const result = await keyRequest("/api/model-keys", "PATCH", { action: "validate", credentialId: key.id });
    const ok = result.ok && result.validationStatus === "accessible";
    let text = result.error ?? modelKeyStatus(result.validationStatus ?? "unavailable");
    if (ok) text = "Model access checked without generating tokens. Your provider still needs available quota when you build.";
    setFeedback({ ok, text });
    setPending(null);
    router.refresh();
  }

  async function remove(key: StoredKeyView): Promise<void> {
    setPending(key.id);
    let path = `/api/model-keys?provider=${key.provider}`;
    if (key.custodyMode === "gateway") path = `/api/model-gateways?id=${encodeURIComponent(key.id)}`;
    const result = await keyRequest(path, "DELETE");
    setFeedback({ ok: result.ok, text: result.error ?? "Connection removed. Future requests using it will stop." });
    setPending(null);
    router.refresh();
  }

  const field = "min-h-11 min-w-0 rounded-lg border border-line bg-raised px-3 text-sm focus-visible:outline-2 focus-visible:outline-hood disabled:opacity-50";
  return <div className="space-y-5 px-5 py-4">
    <form method="post" className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="grid gap-1.5 text-sm">Provider
        <select className={field} value={provider} disabled={disabled} onChange={(event) => { setProvider(event.target.value as ProviderId); setModel(""); }}>
          {Object.entries(PROVIDERS).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1.5 text-sm">API key
        <input className={field} type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your provider key" autoComplete="off" spellCheck={false} disabled={disabled} required minLength={16} maxLength={512} />
      </label>
      <div className="flex flex-wrap justify-between gap-2 text-xs text-ink-faint">
        <span>Model: {model.trim() || defaultModel(provider)}</span>
        <a href={PROVIDERS[provider].url} target="_blank" rel="noreferrer" className="underline underline-offset-4">Get a {PROVIDERS[provider].name} key</a>
      </div>
      <details className="text-sm text-ink-soft">
        <summary className="cursor-pointer py-1">Choose a different model</summary>
        <label className="mt-2 grid gap-1.5">Model ID<input className={field} value={model} onChange={(event) => setModel(event.target.value)} placeholder={defaultModel(provider)} disabled={disabled} maxLength={100} /></label>
      </details>
      {replacing ? <p className="text-xs leading-5 text-ink-faint">Replacing this key stops later requests from builds using its previous version.</p> : null}
      <button className="min-h-11 w-full rounded-lg bg-ink px-4 text-sm font-medium text-paper hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:opacity-50" disabled={disabled || apiKey.trim().length < 16} type="submit">{pending === "save" ? "Connecting…" : "Connect key"}</button>
      <p className="text-xs leading-5 text-ink-faint">Your key is encrypted in storage and used by Fletch servers for builds. Server operators can technically access it. You can remove it at any time.</p>
    </form>
    {feedback ? <p role="status" className={`text-sm ${feedback.ok ? "text-ink-soft" : "text-red-700"}`}>{feedback.text}</p> : null}
    {keys.length > 0 ? <div className="space-y-3 border-t border-line pt-4">
      <h3 className="text-sm font-medium">Saved connections</h3>
      {keys.map((key) => <div key={key.id} className="min-w-0 rounded-lg border border-line p-3">
        <p className="text-sm font-medium">{PROVIDERS[key.provider].name}</p>
        <p className="break-all text-xs leading-5 text-ink-faint">{key.model} · {connectionStatus(key)}</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <a href={`/dashboard/build?modelKey=${encodeURIComponent(key.id)}`} className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">Use in Build</a>
          {key.custodyMode === "hosted" ? <button type="button" className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50" disabled={disabled} onClick={() => void check(key)}>Check access</button> : null}
          <button type="button" className="min-h-11 text-sm underline underline-offset-4 disabled:opacity-50" disabled={disabled} onClick={() => void remove(key)}>Remove</button>
        </div>
      </div>)}
      <a href="/dashboard/build" className="inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4">Open Build</a>
    </div> : null}
  </div>;
}
