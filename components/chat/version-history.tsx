"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveMode } from "@/components/chat/workspace-mode";
import type { ProjectVersion, ProjectVersionDetail, RestoredProject } from "@/lib/build/version-types";

interface Props {
  projectId?: string;
  running?: boolean;
  refreshKey?: string | number;
}

async function readJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not load this version.");
  return data as T;
}

function dateLabel(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function recordedChecks(version: ProjectVersionDetail): string {
  let compile = "no compile report";
  if (version.compile) compile = version.compile.ok ? "compile passed" : "compile failed";
  const tests = version.tests ? `${version.tests.passed} tests passed, ${version.tests.failed} failed` : "no test report";
  return `${compile} · ${tests}`;
}

export function VersionHistory({ projectId, running, refreshKey }: Props): React.ReactElement | null {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<{ versionId: string; sourceHash: string; id: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [savedDetail, setDetail] = useState<ProjectVersionDetail | null>(null);
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const base = `/api/projects/${encodeURIComponent(projectId ?? "")}/versions`;
  const detail = savedDetail?.id === selected ? savedDetail : null;

  useEffect(function toggleDialog() {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  useEffect(function loadVersions() {
    if (!open || !projectId) return;
    const controller = new AbortController();
    readJson<{ versions: ProjectVersion[] }>(base, { signal: controller.signal }).then(function loaded(data) {
      setVersions(data.versions);
      setSelected(function keep(previous) { return data.versions.some(function match(version) { return version.id === previous; }) ? previous : data.versions[0]?.id ?? null; });
    }).catch(function failed(cause: Error) {
      if (!controller.signal.aborted) setError(cause.message);
    }).finally(function finished() {
      if (!controller.signal.aborted) setLoading(false);
    });
    return function cancel() { controller.abort(); };
  }, [open, projectId, base, running, refreshKey]);

  useEffect(function loadVersion() {
    if (!open || !selected) return;
    const controller = new AbortController();
    readJson<{ version: ProjectVersionDetail }>(`${base}/${encodeURIComponent(selected)}`, { signal: controller.signal }).then(function loaded(data) {
      setDetail(data.version);
      setFile(null);
      setContent(null);
      setConfirming(false);
    }).catch(function failed(cause: Error) {
      if (!controller.signal.aborted) { setDetail(null); setError(cause.message); }
    });
    return function cancel() { controller.abort(); };
  }, [open, selected, base, running, refreshKey]);

  useEffect(function loadFile() {
    if (!open || !selected || !file) return;
    const controller = new AbortController();
    readJson<{ content: string }>(`${base}/${encodeURIComponent(selected)}?path=${encodeURIComponent(file)}`, { signal: controller.signal }).then(function loaded(data) {
      setContent(data.content);
    }).catch(function failed(cause: Error) {
      if (!controller.signal.aborted) setError(cause.message);
    });
    return function cancel() { controller.abort(); };
  }, [open, selected, file, base]);

  async function restoreCopy(): Promise<void> {
    if (!selected || !detail?.sourceHash || restoring) return;
    if (request.current?.versionId !== selected || request.current.sourceHash !== detail.sourceHash) {
      request.current = { versionId: selected, sourceHash: detail.sourceHash, id: crypto.randomUUID() };
    }
    setRestoring(true);
    setError(null);
    try {
      const data = await readJson<{ project: RestoredProject }>(`${base}/${encodeURIComponent(selected)}/restore`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: request.current.id, sourceHash: detail.sourceHash }),
      });
      setOpen(false);
      let destination = `/dashboard/build?project=${encodeURIComponent(data.project.projectId)}`;
      try { saveMode(window.localStorage, "code", data.project.projectId); }
      catch { destination += "&view=developer"; }
      router.push(destination);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not restore this copy.");
    } finally {
      setRestoring(false);
    }
  }

  if (!projectId) return null;
  return <>
    <button type="button" onClick={function show() { setError(null); setLoading(true); setOpen(true); }} className="shrink-0 rounded-md px-2.5 py-1.5 focus-visible:outline-2 focus-visible:outline-hood text-xs font-medium text-ink-faint hover:bg-raised hover:text-ink">History</button>
    <dialog ref={dialog} onCancel={function cancel() { setOpen(false); }} onClose={function closed() { setOpen(false); }} aria-labelledby="version-history-title"
      className="fixed inset-0 m-auto max-h-[90dvh] w-[min(960px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-black/50">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div><h2 id="version-history-title" className="text-base font-semibold">Version history</h2><p className="mt-1 text-xs text-ink-faint">Inspect saved source and recorded build results.</p></div>
        <button type="button" onClick={function close() { setOpen(false); }} className="rounded-md px-3 py-2 focus-visible:outline-2 focus-visible:outline-hood text-sm hover:bg-raised">Close</button>
      </div>
      {error && <p role="alert" className="border-b border-line px-5 py-3 text-sm text-red-600">{error}</p>}
      <div className="grid max-h-[calc(90dvh-90px)] overflow-auto sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="max-h-48 overflow-y-auto border-b border-line p-3 sm:max-h-none sm:border-b-0 sm:border-r">
          {loading && <p role="status" className="p-2 text-sm text-ink-faint">Loading versions…</p>}
          {!loading && versions.length === 0 && <p className="p-2 text-sm text-ink-faint">Builds appear here when they are saved.</p>}
          <ol className="space-y-1">{versions.map(function version(item) {
            return <li key={item.id}><button type="button" disabled={restoring} aria-pressed={selected === item.id}
              onClick={function inspect() { setError(null); setConfirming(false); setFile(null); setContent(null); setSelected(item.id); }}
              className={`w-full rounded-lg p-3 focus-visible:outline-2 focus-visible:outline-hood text-left text-sm ${selected === item.id ? "bg-raised ring-1 ring-line" : "hover:bg-raised"}`}>
              <span className="flex justify-between gap-2 font-medium"><span>{item.status === "restored" ? "Restored source" : "Saved build"}</span><span className="text-xs text-ink-faint">{item.status}</span></span>
              <span className="mt-1 block text-xs text-ink-faint">{dateLabel(item.createdAt)}</span>
              <span className="mt-2 line-clamp-2 break-words text-xs">{item.prompt}</span>
            </button></li>;
          })}</ol>
          {versions.length === 100 && <p className="mt-3 text-xs text-ink-faint">Showing the 100 most recent versions.</p>}
        </div>
        <div className="min-w-0 p-5">
          {!detail && selected && <p role="status" className="text-sm text-ink-faint">Loading saved version…</p>}
          {detail && <>
            <p className="text-sm font-medium">{detail.status === "restored" ? "Source restored as a separate app" : "Saved build"}</p>
            <p className="mt-1 text-xs text-ink-faint">{dateLabel(detail.createdAt)} · {detail.status}</p>
            <details className="mt-3 text-sm"><summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-hood">Saved request</summary><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{detail.prompt}</p></details>
            {detail.status === "restored" && <p className="mt-3 text-sm text-ink-faint">This copy starts from the saved source. Send a change to build and publish it. Results below were recorded by the original build.</p>}
            <div className="mt-4 rounded-lg border border-line p-3 text-xs text-ink-faint">
              <p>Recorded checks: {recordedChecks(detail)}</p>
              {detail.sourceStage && <p className="mt-1">Saved source stage: {detail.sourceStage}</p>}
              {detail.sourceError && <p className="mt-1">{detail.sourceError}</p>}
            </div>
            {detail.sourceAvailable && !confirming && <button type="button" onClick={function confirm() { setConfirming(true); }}
              className="mt-4 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood bg-ink px-4 py-2 text-sm font-medium text-paper">Restore a copy</button>}
            {confirming && <div className="mt-4 rounded-lg border border-line bg-raised p-4">
              <p className="text-sm font-medium">Restore this source as a new app?</p>
              <p className="mt-2 text-sm text-ink-faint">Your original app, history and live release stay in place. The copy includes the saved files and brief. Restoring uses no build credits. Publish the copy through a new build when you are ready.</p>
              <p className="mt-2 text-xs text-ink-faint">Existing contracts and on-chain transactions remain unchanged.</p>
              <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={restoring} onClick={restoreCopy} className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50">{restoring ? "Restoring…" : "Confirm restore copy"}</button>
                <button type="button" disabled={restoring} onClick={function cancelRestore() { setConfirming(false); }} className="rounded-lg px-4 py-2 focus-visible:outline-2 focus-visible:outline-hood text-sm hover:bg-paper">Cancel</button></div>
            </div>}
            <div className="mt-5"><p className="mb-2 text-xs font-medium">Saved files ({detail.files.length})</p>
              <ul aria-label="Saved source files" className="max-h-36 overflow-auto rounded-lg border border-line bg-paper p-1">{detail.files.map(function sourceFile(path) {
                return <li key={path}><button type="button" aria-pressed={file === path}
                  onClick={function choose() { setError(null); setContent(null); setFile(path); }}
                  className={`w-full break-all rounded-md px-2 py-1.5 text-left text-xs hover:bg-panel focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-hood ${file === path ? "bg-panel" : ""}`}>{path}</button></li>;
              })}</ul>
              {file && <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-line bg-raised p-3 text-[11px] leading-relaxed"><code>{content ?? "Loading saved source…"}</code></pre>}
              {!detail.sourceAvailable && detail.artifacts.length > 0 && <ul className="mt-3 space-y-1 text-xs text-ink-faint">{detail.artifacts.map(function artifact(item) { return <li key={item.path}>{item.path} · {item.lines} lines recorded</li>; })}</ul>}
            </div>
          </>}
        </div>
      </div>
    </dialog>
  </>;
}
