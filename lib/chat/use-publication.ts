"use client";
import { useCallback, useEffect, useState } from "react";
import type { PublicationStatus } from "@/lib/hosting/publication-types";

function keepPreview(previous: PublicationStatus | null, next: PublicationStatus): PublicationStatus {
  if (previous?.draft && next.draft?.buildId === previous.draft.buildId) {
    const expires = /\/(\d{10})\.[A-Za-z0-9_-]+\//.exec(previous.draft.previewUrl)?.[1];
    if (expires && Number(expires) * 1000 > Date.now() + 300_000) {
      return { ...next, draft: { ...next.draft, previewUrl: previous.draft.previewUrl } };
    }
  }
  return next;
}

export function usePublication(projectId: string | undefined, building: boolean): {
  status: PublicationStatus | null; error: string | null; submitting: boolean; publish: () => Promise<void>;
} {
  const [status, setStatus] = useState<PublicationStatus | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const active = status?.job?.state === "queued" || status?.job?.state === "publishing";

  useEffect(function observe() {
    if (!projectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read(): Promise<void> {
      if (controller.signal.aborted) return;
      try {
        const response = await fetch(`/api/projects/${projectId}/publish`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Publication status is unavailable. Your saved work is retained.");
        const next = await response.json() as PublicationStatus;
        if (!controller.signal.aborted) {
          setStatus(previous => keepPreview(previous, next));
          setReadError(null);
          if (next.job?.buildId === next.draft?.buildId && next.job?.state !== "failed") setActionError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setReadError(cause instanceof Error ? cause.message : "Publication status is unavailable.");
      } finally {
        if (!controller.signal.aborted) {
          let interval = 10_000;
          if (active) interval = 2000;
          else if (building) interval = 5000;
          timer = setTimeout(read, interval);
        }
      }
    }
    void read();
    return function stop() { controller.abort(); clearTimeout(timer); };
  }, [projectId, building, active, refresh]);

  const publish = useCallback(async function publish(): Promise<void> {
    if (!projectId || !status?.draft || submitting) return;
    setSubmitting(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: status.draft.buildId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Publishing could not start. Try again.");
      setStatus(previous => keepPreview(previous, body));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Publishing could not start. Try again.");
    } finally {
      setSubmitting(false);
      setRefresh(value => value + 1);
    }
  }, [projectId, status, submitting]);

  return { status, error: actionError ?? readError, submitting, publish };
}
