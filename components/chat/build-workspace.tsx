"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  artifactChanges,
  type ArtifactChange,
} from "@/lib/chat/artifact-changes";
import { usePublication } from "@/lib/chat/use-publication";
import { PublishControl } from "@/components/chat/publish-control";
import { mergePublishedResult } from "@/lib/chat/published-result";
import { updateBuildEvidence, type BuildEvidence } from "@/lib/chat/build-evidence";
import { AppPicker } from "@/components/chat/app-picker";
import { FileCount } from "@/components/chat/file-count";
import { useHydrated } from "@/lib/use-hydrated";
import { AgentChat } from "@/components/chat/agent-chat";
import {
  ArtifactPanel,
  type BuildResult,
} from "@/components/chat/artifact-panel";
import { RailResizer } from "@/components/chat/rail-resizer";
import { VersionHistory } from "@/components/chat/version-history";
import { AppCanvas } from "@/components/chat/app-canvas";
import { ProgressTrack } from "@/components/chat/progress-track";
import { ActionCard } from "@/components/chat/action-card";
import { BuildVerdict } from "@/components/chat/build-verdict";
import { MAINNET_AUDIT_PROMPT } from "@/lib/agent/audit-prompt";
import {
  readMode,
  saveMode,
  type WorkspaceMode,
} from "@/components/chat/workspace-mode";
import type { Stage } from "@/components/chat/pipeline";
import type {
  AnalysisReport,
  BuildArtifact,
  CompileReport,
  TestReport,
} from "@/lib/build/types";
import type { ChatMessage } from "@/lib/chat/types";

export interface WorkspaceProject {
  id: string;
  name: string;
  slug: string;
  buildCount: number;
  previewUrl?: string | null;
}

interface BuildWorkspaceProps {
  initialPrompt?: string;
  projectId?: string;
  initialMessages?: ChatMessage[];
  initialArtifacts?: BuildArtifact[];
  initialArtifactChanges?: Record<string, ArtifactChange>;
  initialResult?: BuildResult | null;
  initialTemplateVersion?: string | null;
  initialCompile?: CompileReport | null;
  initialTests?: TestReport | null;
  initialAnalysis?: AnalysisReport | null;
  initialNoContract?: boolean;
  projects?: WorkspaceProject[];
  initialView?: "simple" | "developer";
}

interface WorkspaceProps extends BuildWorkspaceProps {
  onProjectCreated: (id: string) => void;
}

function defaultMode(
  projectId?: string,
  initialView?: "simple" | "developer",
): WorkspaceMode {
  if (initialView === "developer") return "code";
  return projectId ? "preview" : "chat";
}

// A saved-project navigation resets its state. Assigning an ID to the current
// new project keeps the component, composer and existing stream alive.
export function BuildWorkspace(props: BuildWorkspaceProps): React.ReactElement {
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [route, setRoute] = useState({
    projectId: props.projectId,
    key: props.projectId ?? "new",
    generation: 0,
  });
  if (props.projectId !== route.projectId) {
    const generation = route.generation + 1;
    const key =
      props.projectId === createdId
        ? route.key
        : `${props.projectId ?? "new"}:${generation}`;
    setRoute({ projectId: props.projectId, key, generation });
  }
  return (
    <Workspace key={route.key} {...props} onProjectCreated={setCreatedId} />
  );
}

function Workspace({
  initialPrompt,
  projectId,
  initialMessages,
  initialArtifacts,
  initialArtifactChanges,
  initialResult,
  initialTemplateVersion,
  initialCompile,
  initialTests,
  initialAnalysis,
  initialNoContract = false,
  projects = [],
  initialView,
  onProjectCreated,
}: WorkspaceProps): React.ReactElement {
  const [activeProjectId, setActiveProjectId] = useState(projectId);
  const hydrated = useHydrated();
  const [artifacts, setArtifacts] = useState<BuildArtifact[]>(
    initialArtifacts ?? [],
  );
  const [result, setResult] = useState<BuildResult | null>(
    initialResult ?? null,
  );
  const [{ compile, tests, analysis }, setEvidence] = useState<BuildEvidence>({
    compile: initialCompile ?? null,
    tests: initialTests ?? null,
    analysis: initialAnalysis ?? null,
  });
  const [noContract, setNoContract] = useState(initialNoContract);
  const [running, setRunning] = useState(false);
  const publication = usePublication(activeProjectId, running);
  const [status, setStatus] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [view, setView] = useState<WorkspaceMode>(
    defaultMode(projectId, initialView),
  );
  const [reportRequest, setReportRequest] = useState(0);
  const [externalPrompt, setExternalPrompt] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [changes, setChanges] = useState<Record<string, ArtifactChange>>(
    initialArtifactChanges ?? {},
  );
  const baselineRef = useRef(initialArtifacts ?? []);
  const initialProjectRef = useRef(projectId);
  const [hasRun, setHasRun] = useState(false);
  const [runTemplateVersion, setRunTemplateVersion] = useState<string | null>(null);
  const savedResultRef = useRef(initialResult);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const conversationId = useId();
  const fileRevision = useRef(0);
  const [fileError, setFileError] = useState<string | null>(null);

  useEffect(function watchFiles() {
    if (!activeProjectId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pending = false;
    async function read(): Promise<void> {
      if (pending || controller.signal.aborted) return;
      clearTimeout(timer);
      let delay = running || view === "code" ? 5000 : 15_000;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(read, delay);
        return;
      }
      pending = true;
      const revision = fileRevision.current;
      try {
        const response = await fetch(`/api/projects/${activeProjectId}/files`, {
          cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]),
        });
        if (response.status === 429) delay = Math.max(delay, Math.min(120, Number(response.headers.get("Retry-After")) || 60) * 1000);
        if (!response.ok) throw new Error("File updates paused. Retrying automatically.");
        const body = await response.json() as { artifacts: BuildArtifact[] };
        if (!Array.isArray(body.artifacts)) throw new Error("File updates are unavailable. Retrying automatically.");
        if (controller.signal.aborted) return;
        setFileError(null);
        // A streamed write received during this read is newer than its snapshot.
        if (fileRevision.current !== revision) return;
        const next = body.artifacts;
        setArtifacts(function replace(previous) {
          return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
        });
        if (running) setChanges(artifactChanges(baselineRef.current, next, next, true));
      } catch (cause) {
        if (!controller.signal.aborted) setFileError(cause instanceof Error ? cause.message : "File updates paused. Retrying automatically.");
      } finally {
        pending = false;
        if (!controller.signal.aborted) timer = setTimeout(read, delay);
      }
    }
    function resume(): void { if (document.visibilityState === "visible") void read(); }
    void read();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return function stop() {
      controller.abort(); clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [activeProjectId, running, view]);

  useEffect(
    function restorePreferences() {
      const frame = requestAnimationFrame(function restore() {
        try {
          if (!initialView)
            setView(
              readMode(window.localStorage, initialProjectRef.current) ??
                defaultMode(initialProjectRef.current),
            );
        } catch {
          /* The workspace works with in-memory preferences. */
        }
      });
      return function cancel() {
        cancelAnimationFrame(frame);
      };
    },
    [initialView],
  );

  useEffect(
    function refreshSavedPublication() {
      if (savedResultRef.current === initialResult) return;
      savedResultRef.current = initialResult;
      if (running || !initialResult) return;
      const frame = requestAnimationFrame(function sync() {
        setResult(function merge(previous) {
          return mergePublishedResult(previous, initialResult);
        });
      });
      return function cancel() {
        cancelAnimationFrame(frame);
      };
    },
    [initialResult, running],
  );

  function chooseView(next: WorkspaceMode): void {
    setView(next);
    try {
      saveMode(window.localStorage, next, activeProjectId);
    } catch {
      /* Storage may be blocked. */
    }
  }

  function createdProject(id: string): void {
    try {
      saveMode(window.localStorage, view, id);
    } catch {
      /* Keep the current mode in memory. */
    }
    setActiveProjectId(id);
    onProjectCreated(id);
  }

  function startRun(streaming: boolean): void {
    setRunning(streaming);
    if (!streaming) return;
    setHasRun(true);
    setRunTemplateVersion(null);
    baselineRef.current = artifacts;
    setChanges({});
    setEvidence({ compile: null, tests: null, analysis: null });
    setNoContract(false);
    setResult(function keepPublication(previous) {
      return previous ? { ...previous, notes: undefined } : null;
    });
  }

  function addArtifact(artifact: BuildArtifact): void {
    fileRevision.current += 1;
    const change = artifactChanges(
      baselineRef.current,
      [artifact],
      [artifact],
      true,
    )[artifact.path];
    setChanges(function update(previous) {
      const next = { ...previous };
      if (change) next[artifact.path] = change;
      else delete next[artifact.path];
      return next;
    });
    setArtifacts(function upsert(previous) {
      const index = previous.findIndex(function same(item) { return item.path === artifact.path; });
      if (index < 0) return [...previous, artifact];
      const next = [...previous];
      next[index] = artifact;
      return next;
    });
  }

  function mergeResult(next: BuildResult): void {
    setResult(function keep(previous) {
      return mergePublishedResult(previous, next);
    });
  }

  function sendPrompt(text: string): void {
    setExternalPrompt({ text, nonce: Date.now() });
    chooseView("chat");
  }

  function openReport(): void {
    setReportRequest(function next(value) {
      return value + 1;
    });
    chooseView("code");
  }

  const hasThread =
    Boolean(initialMessages?.length) || running || result !== null || hasRun;
  const chatOnly = view === "chat";
  let displayedResult = result;
  if (publication.status) {
    const { draft, live } = publication.status;
    displayedResult = {
      ...result,
      previewUrl: live?.url,
      draftReady: Boolean(draft && draft.buildId !== live?.buildId),
    };
  }


  return (
    <div ref={workspaceRef} inert={!hydrated} className="flex h-full min-h-0 min-w-0 flex-col [&[data-rail-dragging]_iframe]:pointer-events-none [&[data-rail-dragging]]:select-none" data-workspace-mode={view} style={{ "--rail-width": "380px" } as React.CSSProperties}>
      <header className={`grid max-h-[55%] shrink-0 grid-cols-1 items-center overflow-y-auto lg:max-h-none lg:overflow-visible gap-2 border-b border-line bg-raised py-2 lg:gap-3 ${chatOnly ? "lg:grid-cols-[260px_minmax(0,1fr)_auto]" : "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)_auto]"}`}>
        <div className="order-1 min-w-0 px-3" data-project-strip>
          <AppPicker projects={projects} projectId={activeProjectId} />
        </div>
        {hasThread ? <div className={`order-3 min-w-0 space-y-1 px-3 lg:order-2 lg:block ${running ? "block" : "hidden"}`} data-project-pipeline>
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
            <ProgressTrack
              stage={stage} running={running} result={displayedResult} noContract={noContract}
              hasThread={hasThread} compile={compile} tests={tests} analysis={analysis} onOpenCode={openReport}
              onOpenChat={function openChat() { chooseView("chat"); }}
            />
            {hasThread ? <button
              type="button" disabled={running} aria-label="Audit for mainnet"
              onClick={function audit() { sendPrompt(MAINNET_AUDIT_PROMPT); }}
              className="min-h-11 sm:min-h-8 rounded-lg px-1.5 py-1 text-[11px] text-ink-soft hover:bg-panel focus-visible:outline-2 focus-visible:outline-hood disabled:opacity-40"
            ><span className="sm:hidden">Audit</span><span className="hidden sm:inline">Audit for mainnet</span></button> : null}
          </div>
          <BuildVerdict
            compile={compile} tests={tests} analysis={analysis} noContract={noContract}
            running={running} result={displayedResult} onReport={openReport}
          />
          <ActionCard result={displayedResult} projectId={activeProjectId} running={running} onPrompt={sendPrompt} />
        </div> : null}
        <div className="order-2 flex flex-wrap items-center justify-end gap-2 px-3 lg:order-3 lg:pl-0">
          {activeProjectId ? <PublishControl status={publication.status} error={publication.error} submitting={publication.submitting} building={running} onPublish={publication.publish} projectSlug={projects.find(function current(project) { return project.id === activeProjectId; })?.slug} /> : null}
          <VersionHistory projectId={activeProjectId} running={running} />
          <div className="flex items-center gap-1 rounded-lg border border-line p-0.5" role="group" aria-label="Workspace mode"
            onKeyDown={function navigate(event) {
              const modes: WorkspaceMode[] = ["preview", "code", "chat"];
              let index = modes.indexOf(view);
              if (event.key === "ArrowRight") index = (index + 1) % modes.length;
              else if (event.key === "ArrowLeft") index = (index + modes.length - 1) % modes.length;
              else if (event.key === "Home") index = 0;
              else if (event.key === "End") index = modes.length - 1;
              else return;
              event.preventDefault();
              chooseView(modes[index]);
              event.currentTarget.querySelectorAll("button")[index]?.focus();
            }}>
            {(["preview", "code", "chat"] as const).map(function mode(item) {
              return <button key={item} type="button" aria-pressed={view === item} aria-label={item[0].toUpperCase() + item.slice(1)}
                onClick={function choose() { chooseView(item); }}
                className={`h-11 sm:h-8 rounded-md px-2.5 text-[12px] font-medium capitalize focus-visible:outline-2 focus-visible:outline-hood ${view === item ? "bg-ink text-paper" : "text-ink-soft hover:text-ink"}`}>
                {item[0].toUpperCase() + item.slice(1)}
                {item === "code" ? <span aria-hidden="true" className="ml-1.5 inline-flex rounded bg-current/10 px-1 text-[10px]"><FileCount value={artifacts.length} /></span> : null}
              </button>;
            })}
          </div>
        </div>
      </header>
      <div className={`relative grid min-h-0 min-w-0 flex-1 ${chatOnly ? "grid-cols-1" : "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)]"}`}>
        <div className={`min-h-0 min-w-0 flex-col ${chatOnly ? "flex" : "hidden border-r border-line lg:flex"}`} data-conversation-pane id={conversationId}>
          <AgentChat
            mode="app" layout={chatOnly ? "reading" : "rail"}
            initialPrompt={initialPrompt} projectId={activeProjectId} initialMessages={initialMessages}
            onArtifact={addArtifact} onTemplateVersion={setRunTemplateVersion}
            onCompile={function compiled(report) {
              setEvidence(function update(previous) {
                return updateBuildEvidence(previous, { phase: "compiling", compile: report });
              });
            }}
            onTests={function tested(report) {
              setEvidence(function update(previous) {
                return updateBuildEvidence(previous, { phase: "testing", tests: report });
              });
            }}
            onAnalysis={function analysed(report) {
              setEvidence(function update(previous) {
                return updateBuildEvidence(previous, { phase: "testing", analysis: report });
              });
            }}
            onResult={mergeResult}
            onStreamingChange={startRun} onStatusChange={setStatus} onStageChange={setStage}
            onNeedsChange={function needs(verdict) { if (verdict) setNoContract(!verdict.contract); }}
            externalPrompt={externalPrompt} onProjectCreated={createdProject}
          />
        </div>
        <RailResizer workspaceRef={workspaceRef} conversationId={conversationId} disabled={chatOnly} />
        <div className={`min-h-0 min-w-0 ${view === "preview" ? "block" : "hidden"}`}>
          <AppCanvas publication={publication.status} result={displayedResult} running={running} stage={stage} status={status} hasThread={hasThread} />
        </div>
        <div className={`min-h-0 min-w-0 ${view === "code" ? "block" : "hidden"}`}>
          <ArtifactPanel
            artifacts={artifacts} templateVersion={hasRun ? runTemplateVersion : initialTemplateVersion ?? null}
            compile={compile} tests={tests} analysis={analysis} running={running} status={status} stage={stage}
            projectId={activeProjectId} changes={changes} reportRequest={reportRequest}
            visible={view === "code"} fileError={fileError}
          />
        </div>
      </div>
    </div>
  );
}
