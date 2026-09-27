"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiKeySummary } from "@/lib/auth/api-keys";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/auth/scopes";
import { formatWhen } from "@/components/dashboard/settings/format";
import { readBody, safeFetch } from "@/components/dashboard/settings/request";
import { Check, Copy } from "@/components/ui/icons";

// Key management stays session-only (app/api/keys/*): a leaked API key can
// mint or revoke other keys nowhere in this app, this card included. Every
// call here rides the browser session cookie, never a Bearer token.

const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  "registry:read": "Read the registry",
  "watchers:read": "Read watchers",
  "watchers:write": "Create and manage watchers",
  "builds:read": "Read builds",
  "projects:read": "Read projects",
};

interface ApiKeysCardProps {
  keys: ApiKeySummary[];
}

interface CreatedKey {
  id: string;
  token: string;
  prefix: string;
}

export function ApiKeysCard({ keys }: ApiKeysCardProps): React.ReactNode {
  const router = useRouter();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  function toggleScope(scope: ApiKeyScope): void {
    setScopes(function next(prev) {
      return prev.includes(scope) ? prev.filter((value) => value !== scope) : [...prev, scope];
    });
  }

  async function createKey(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (scopes.length === 0) {
      setError("Pick at least one scope.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const response = await safeFetch("/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim() || "Untitled key", scopes }),
    });
    setSubmitting(false);
    if (!response?.ok) {
      const body = await readBody(response);
      setError(typeof body?.error === "string" ? body.error : "Couldn't create the key. Try again.");
      return;
    }
    const body = (await response.json()) as CreatedKey;
    setCreated(body);
    setName("");
    setScopes([]);
    router.refresh();
  }

  async function revoke(id: string, keyName: string): Promise<void> {
    if (!window.confirm(`Revoke "${keyName}"? Any use of this key stops working immediately.`)) {
      return;
    }
    setRevokingId(id);
    setError(null);
    const response = await safeFetch(`/api/keys/${id}`, { method: "DELETE" });
    setRevokingId(null);
    if (!response?.ok) {
      const body = await readBody(response);
      setError(typeof body?.error === "string" ? body.error : "Couldn't revoke this key.");
      return;
    }
    router.refresh();
  }

  async function copyToken(token: string): Promise<void> {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(function reset() {
      setCopied(false);
    }, 1600);
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-raised">
      <h2 className="border-b border-line px-5 py-3 text-[14px] font-medium text-ink">API keys</h2>

      {created ? (
        <div className="mx-5 mt-4 rounded-card border border-hood-deep/30 bg-hood-wash px-4 py-4">
          <p className="text-[13.5px] font-medium text-ink">
            &ldquo;{created.prefix}&hellip;&rdquo; created. This is the only time you will see the full token.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-line bg-raised px-3 py-2 font-mono text-[12.5px] text-ink">
              {created.token}
            </code>
            <button
              type="button"
              onClick={function onCopy() {
                void copyToken(created.token);
              }}
              aria-label="Copy API key"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
            >
              {copied ? (
                <Check className="h-4 w-4 text-hood-deep" strokeWidth={2.2} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={1.8} />
              )}
            </button>
          </div>
          <button
            type="button"
            onClick={function dismiss() {
              setCreated(null);
            }}
            className="mt-3 text-[12.5px] text-ink-faint underline underline-offset-4 hover:text-ink"
          >
            Hide saved secret
          </button>
        </div>
      ) : null}

      {keys.length === 0 ? (
        <p className="px-5 py-6 text-[14px] text-ink-soft">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {keys.map(function renderKey(key) {
            const revoked = key.revokedAt !== null;
            return (
              <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className={`text-[14px] font-medium ${revoked ? "text-ink-faint line-through" : "text-ink"}`}>
                    {key.name}
                  </p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink-faint">
                    {key.prefix}&hellip; · last used {formatWhen(key.lastUsedAt)}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {key.scopes.map(function renderScope(scope) {
                      return (
                        <span
                          key={scope}
                          className="rounded-full bg-panel px-2 py-0.5 font-mono text-[10.5px] text-ink-soft"
                        >
                          {scope}
                        </span>
                      );
                    })}
                  </div>
                </div>
                {revoked ? (
                  <span className="mono-label !text-[10px] shrink-0 text-ink-faint">revoked</span>
                ) : (
                  <button
                    type="button"
                    onClick={function onRevoke() {
                      void revoke(key.id, key.name);
                    }}
                    disabled={revokingId === key.id}
                    className="flex h-11 shrink-0 items-center rounded-full border border-line px-4 text-[13px] text-red-700 transition-colors hover:border-red-300 hover:bg-red-50 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={createKey} className="flex flex-col gap-3 border-t border-line px-5 py-4">
        <p className="text-[13px] font-medium text-ink">New key</p>
        <input
          type="text"
          value={name}
          onChange={function onChange(event) {
            setName(event.target.value);
          }}
          placeholder="Name, e.g. my script"
          className="h-11 rounded-md border border-line bg-raised px-3 text-[14px] text-ink outline-none focus:border-line-strong"
        />
        <div className="grid gap-1.5 sm:grid-cols-2">
          {API_KEY_SCOPES.map(function renderCheckbox(scope) {
            return (
              <label
                key={scope}
                className="flex h-11 items-center gap-2.5 rounded-md border border-line px-3 text-[13px] text-ink-soft"
              >
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={function onToggle() {
                    toggleScope(scope);
                  }}
                  className="h-4 w-4 accent-hood-deep"
                />
                {SCOPE_LABELS[scope]}
              </label>
            );
          })}
        </div>
        {error ? <p className="text-[13px] text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="flex h-11 items-center justify-center rounded-full bg-ink px-5 text-[13.5px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50 sm:self-start"
        >
          {submitting ? "Creating…" : "Create key"}
        </button>
      </form>
    </section>
  );
}
