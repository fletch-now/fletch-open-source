"use client";

import { useEffect, useState } from "react";
import { Check } from "@/components/ui/icons";
import { ControlPopover, PopoverChevron, POPOVER_ITEM_CLASS } from "@/components/chat/control-popover";
import type { BuildSelection, ModelCapabilities, ProviderId } from "@/lib/agent/selection";
import type { StoredModelKey } from "@/lib/agent/user-keys";
import { modelKeyStatus } from "@/lib/agent/key-status";

export const PROVIDER_NAMES: Record<ProviderId, string> = { openai: "OpenAI", anthropic: "Anthropic", kimi: "Kimi" };

function preferenceKey(userId: string, projectId?: string): string {
  return `fletch.model:${userId}:${projectId ?? "new"}`;
}

interface ModelChoiceState {
  keys: StoredModelKey[]; value: string; choose: (value: string) => void;
  selection: BuildSelection | null; restore: (selection: BuildSelection) => void; rememberProject: (id: string) => void;
  ready: boolean; error: string | null; acceptsImages: boolean;
}

export function useModelChoice(userId?: string, projectId?: string): ModelChoiceState {
  const [keys, setKeys] = useState<StoredModelKey[]>([]);
  const [platform, setPlatform] = useState<{ capabilities: ModelCapabilities; available: boolean } | null>(null);
  const [value, setValue] = useState("platform");
  const [restoredSelection, setRestoredSelection] = useState<BuildSelection | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(function load() {
    if (!userId) return;
    const controller = new AbortController();
    async function read(): Promise<void> {
      let saved = "platform";
      try { saved = localStorage.getItem(preferenceKey(userId!, projectId)) ?? "platform"; } catch { /* Storage is optional. */ }
      const requested = new URLSearchParams(window.location.search).get("modelKey");
      if (requested && !projectId) saved = requested;
      setValue(saved);
      try {
        const response = await fetch("/api/model-keys", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: "no-store" });
        if (!response.ok) throw new Error("Could not load model connections. Reload before choosing your key.");
        const data = await response.json();
        if (!controller.signal.aborted) {
          setKeys(data.keys ?? []); setPlatform(data.platform ?? null); setError(null);
          if (requested && !projectId && data.keys?.some((key: StoredModelKey) => key.id === requested)) {
            try { localStorage.setItem(preferenceKey(userId!), requested); } catch { /* Selection still works for this tab. */ }
          }
        }
      } catch {
        if (!controller.signal.aborted) setError("Could not load model connections. Reload to try again.");
      } finally {
        if (!controller.signal.aborted) setReadyFor(preferenceKey(userId!, projectId));
      }
    }
    void read();
    return function cleanup() { controller.abort(); };
  }, [userId, projectId]);

  function choose(next: string): void {
    setRestoredSelection(null);
    setValue(next);
    const url = new URL(window.location.href);
    if (url.searchParams.has("modelKey")) {
      url.searchParams.delete("modelKey");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    if (!userId) return;
    try { localStorage.setItem(preferenceKey(userId, projectId), next); } catch { /* Choice still works for this tab. */ }
  }
  function restore(selection: BuildSelection): void {
    choose(selection.billingMode === "platform" ? "platform" : selection.credentialId);
    setRestoredSelection(selection);
  }
  function rememberProject(id: string): void {
    if (!userId) return;
    try { localStorage.setItem(preferenceKey(userId, id), value); } catch { /* Choice still works for this tab. */ }
  }
  const key = keys.find((entry) => entry.id === value);
  let selection: BuildSelection | null = null;
  if (value === "platform") selection = { billingMode: "platform" };
  else if (key && !error) selection = { billingMode: "own_key", custodyMode: key.custodyMode, credentialId: key.id, credentialVersion: key.version, provider: key.provider, model: key.model };
  let selectionError = error;
  if (restoredSelection?.billingMode === "own_key") {
    const matches = key && key.id === restoredSelection.credentialId && key.version === restoredSelection.credentialVersion && key.provider === restoredSelection.provider && key.model === restoredSelection.model && key.custodyMode === (restoredSelection.custodyMode ?? "hosted");
    if (matches && !error) selection = restoredSelection;
    else {
      selection = null;
      selectionError = "The queued model connection changed. Choose a connection before submitting again.";
    }
  }
  const acceptsImages = value === "platform" ? platform?.available === true && platform.capabilities.images : key?.capabilities.images === true;
  return { keys, value, choose, restore, selection, rememberProject, ready: !userId || readyFor === preferenceKey(userId, projectId), error: selectionError, acceptsImages };
}

interface Props {
  choice: ModelChoiceState;
  disabled: boolean;
}

export function ModelChoice({ choice, disabled }: Props): React.ReactElement {
  const selected = choice.keys.find((key) => key.id === choice.value);
  let name = "Platform";
  let creditLabel = "";
  let title = "Platform model";
  if (choice.value !== "platform") {
    name = selected ? PROVIDER_NAMES[selected.provider] : "Unavailable";
    creditLabel = "0 credits";
    title = selected ? `${PROVIDER_NAMES[selected.provider]}, ${selected.model}, 0 Fletch credits` : "Saved key unavailable. Choose a connection.";
  }
  if (!choice.ready) title = "Loading model connections";
  const problem = choice.error ?? (choice.value !== "platform" && !selected ? "Saved key unavailable. Choose a connection." : null);
  if (choice.error) name = "Connection error";
  if (problem) title = problem;

  return <div className="relative min-w-0 max-w-[132px] shrink">
    <ControlPopover label="Build model" title={title} disabled={disabled || !choice.ready} side="top" className={`w-full max-w-full px-2 ${problem ? "text-amber-700" : ""}`}
      trigger={<><span className="min-w-0 truncate">{name}</span><span className="shrink-0 text-[10px] text-ink-faint">{creditLabel}</span><PopoverChevron /></>}>
      {function modelMenu(close) {
        return <>
          <button type="button" role="menuitemradio" aria-checked={choice.value === "platform"} data-popover-item tabIndex={-1} className={POPOVER_ITEM_CLASS}
            onClick={function platform() { choice.choose("platform"); close(); }}>
            <span className="flex-1">Platform model<span className="mt-0.5 block text-[11px] text-ink-faint">Uses Fletch credits</span></span>
            {choice.value === "platform" ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : null}
          </button>
          {choice.keys.map(function connection(key) {
            return <button key={key.id} type="button" role="menuitemradio" aria-checked={choice.value === key.id} data-popover-item tabIndex={-1} className={POPOVER_ITEM_CLASS}
              onClick={function choose() { choice.choose(key.id); close(); }}>
              <span className="min-w-0 flex-1"><span className="block truncate">{PROVIDER_NAMES[key.provider]} · {key.model}</span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">0 Fletch credits{key.custodyMode === "gateway" ? " · gateway" : ""}{key.capabilities.images ? " · images" : ""}</span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">{modelKeyStatus(key.validationStatus)}</span></span>
              {choice.value === key.id ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> : null}
            </button>;
          })}
          <p className="px-2.5 py-2 text-[11px] text-ink-faint">Your provider bills usage for own-key builds.</p>
          {problem ? <p role="status" className="px-2.5 pb-2 text-xs text-amber-700">{problem}</p> : null}
          <div role="separator" className="my-1 border-t border-line" />
          <a href="/dashboard/settings#model-keys" role="menuitem" data-popover-item tabIndex={-1} onClick={function manage() { close(); }} className={POPOVER_ITEM_CLASS}>Manage model connections</a>
        </>;
      }}
    </ControlPopover>
    {problem ? <span role="status" className="sr-only">{problem}</span> : null}
  </div>;
}
