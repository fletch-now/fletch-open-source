"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  FileCode2,
  FileCog,
  FileJson,
} from "@/components/ui/icons";
import { FoundryReport } from "@/components/chat/foundry-report";
import { CodeText } from "@/components/chat/code-text";
import { FileCount } from "@/components/chat/file-count";
import type { Stage } from "@/components/chat/pipeline";
import type {
  AnalysisReport,
  BuildArtifact,
  CompileReport,
  TestReport,
} from "@/lib/build/types";

const KIND_ICON = { contract: FileCode2, app: FileJson, config: FileCog };
const KIND_LABEL = {
  contract: "Contracts",
  app: "Front end",
  config: "Config",
};
const REPORT_TAB = ":report";
const ABI_TAB = ":abi";

export interface BuildResult {
  contractAddress?: string;
  contractName?: string;
  explorerUrl?: string;
  previewUrl?: string;
  draftReady?: boolean;
  verified?: boolean;
  notes?: string[];
}

interface ArtifactPanelProps {
  visible?: boolean;
  fileError?: string | null;
  artifacts: BuildArtifact[];
  templateVersion?: string | null;
  compile: CompileReport | null;
  tests: TestReport | null;
  analysis?: AnalysisReport | null;
  running: boolean;
  status?: string | null;
  stage?: Stage;
  projectId?: string;
  changes?: Record<string, "new" | "changed" | "updated">;
  reportRequest?: number;
}

interface LoadedFile {
  identity: string;
  key: string;
  content?: string;
  error?: string;
}

export function ArtifactPanel({
  visible = true,
  fileError,
  artifacts,
  templateVersion = null,
  compile,
  tests,
  analysis = null,
  running,
  status = null,
  stage = "idle",
  projectId,
  changes = {},
  reportRequest = 0,
}: ArtifactPanelProps): React.ReactElement {
  const [picked, setPicked] = useState<string | null>(null);
  const [openPaths, setOpenPaths] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [copied, setCopied] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected =
    picked ?? artifacts[artifacts.length - 1]?.path ?? REPORT_TAB;
  const open = artifacts.find(function match(artifact) {
    return artifact.path === selected;
  });
  const previewIsWhole = Boolean(
    open?.preview !== undefined &&
    open.lines <= open.preview.split("\n").length,
  );
  const fileKey = JSON.stringify([
    projectId,
    open?.path,
    open?.contentHash,
    open?.preview,
    running,
  ]);
  const fullText = loaded?.key === fileKey ? loaded.content : undefined;
  const loadError = loaded?.key === fileKey ? loaded.error : undefined;
  const identity = `${projectId}:${open?.path}`;
  const content = fullText ?? (loaded?.identity === identity ? loaded.content : undefined) ?? open?.preview;
  const abi = compile?.contracts.map(function contract(item) {
    return { contract: item.name, abi: item.abi };
  });
  const abiText = abi?.length ? JSON.stringify(abi, null, 2) : null;
  const tabs = Array.from(
    new Set([REPORT_TAB, ABI_TAB, ...openPaths, ...(open ? [open.path] : [])]),
  );

  useEffect(
    function showReport() {
      if (!reportRequest) return;
      const frame = requestAnimationFrame(function select() {
        setPicked(REPORT_TAB);
      });
      return function cancel() {
        cancelAnimationFrame(frame);
      };
    },
    [reportRequest],
  );

  useEffect(
    function loadFullText() {
      if (!visible || !projectId || !open || previewIsWhole) return;
      const controller = new AbortController();
      fetch(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(open.path)}`,
        { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]), cache: "no-store" },
      )
        .then(async function parse(response): Promise<{ content: string }> {
          if (!response.ok)
            throw new Error("The full file could not be loaded.");
          return response.json();
        })
        .then(function keep(body) {
          if (!controller.signal.aborted)
            setLoaded({ key: fileKey, identity, content: body.content });
        })
        .catch(function failed(error: unknown) {
          if (!controller.signal.aborted)
            setLoaded({
              key: fileKey,
              identity,
              error:
                error instanceof Error
                  ? error.message
                  : "The full file could not be loaded.",
            });
        });
      return function stop() {
        controller.abort();
      };
    },
    [visible, projectId, open, previewIsWhole, fileKey, identity, retry],
  );

  function select(path: string): void {
    setPicked(path);
    setCopied(false);
    if (path === REPORT_TAB || path === ABI_TAB) return;
    setOpenPaths(function remember(previous) {
      return previous.includes(path) ? previous : [...previous, path];
    });
  }

  async function copyText(): Promise<void> {
    const text = selected === ABI_TAB ? abiText : content;
    if (text === undefined || text === null) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      toast.error("Clipboard access was denied. Select the code to copy it.");
    }
  }

  function navigateTabs(event: React.KeyboardEvent<HTMLDivElement>): void {
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    const current = buttons.indexOf(
      document.activeElement as HTMLButtonElement,
    );
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % buttons.length;
    else if (event.key === "ArrowLeft")
      next = (current + buttons.length - 1) % buttons.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next]?.focus();
    buttons[next]?.click();
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-raised">
      <div
        role="tablist"
        aria-label="Code and reports"
        onKeyDown={navigateTabs}
        className="flex shrink-0 overflow-x-auto border-b border-line"
      >
        {tabs.map(function tab(path, index) {
          let label = path.split("/").pop() ?? path;
          if (path === REPORT_TAB) label = "Foundry report";
          if (path === ABI_TAB) label = "ABI";
          return (
            <button
              key={path}
              id={`artifact-tab-${index}`}
              role="tab"
              aria-selected={selected === path}
              aria-controls="artifact-content"
              tabIndex={selected === path ? 0 : -1}
              title={path.startsWith(":") ? `${label} · pinned` : path}
              onClick={function pick() {
                select(path);
              }}
              className={`flex h-10 shrink-0 items-center gap-1.5 border-r border-line px-3 text-[11.5px] ${selected === path ? "bg-hood-wash text-hood-deep" : "text-ink-soft hover:bg-panel"}`}
            >
              {label}
              {changes[path] ? (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-hood"
                  aria-label={changes[path]}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="max-h-[28%] shrink-0 overflow-auto border-b border-line p-2 xl:max-h-none xl:w-52 xl:border-b-0 xl:border-r">
          <p className="px-2 py-1 text-[11px] text-ink-faint">
            <FileCount value={artifacts.length} /> files
            {Object.keys(changes).length
              ? ` · ${Object.keys(changes).length} updated this build`
              : ""}
          </p>
          <p role="status" className={`px-2 pb-2 text-[11px] ${fileError ? "text-amber-700" : "text-ink-faint"}`}>
            {fileError ?? (running ? "Watching for file changes" : "Files refresh automatically")}
          </p>
          {(["contract", "app", "config"] as const).map(function group(kind) {
            const files = artifacts.filter(function match(artifact) {
              return artifact.kind === kind;
            });
            if (!files.length) return null;
            const Icon = KIND_ICON[kind];
            return (
              <details key={kind} open className="mb-2">
                <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-ink-soft">
                  {KIND_LABEL[kind]} · {files.length}
                </summary>
                {files.map(function file(artifact) {
                  return (
                    <button
                      key={artifact.path}
                      type="button"
                      onClick={function pick() {
                        select(artifact.path);
                      }}
                      title={artifact.path}
                      className={`motion-safe:animate-[file-arrival_240ms_ease-out] flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left ${selected === artifact.path ? "bg-hood-wash text-hood-deep" : "text-ink-soft hover:bg-panel"}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                        {artifact.path}
                      </span>
                      {changes[artifact.path] ? (
                        <span className="text-[9px] capitalize text-hood-deep">
                          {changes[artifact.path]}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </details>
            );
          })}
        </div>
        <div
          id="artifact-content"
          role="tabpanel"
          aria-labelledby={`artifact-tab-${tabs.indexOf(selected)}`}
          tabIndex={0}
          className="flex min-h-0 min-w-0 flex-1 flex-col"
        >
          {open || (selected === ABI_TAB && abiText) ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-soft">
                {open?.path ?? "Contract ABI"}
              </span>
              <button
                type="button"
                onClick={copyText}
                disabled={
                  selected !== ABI_TAB &&
                  !previewIsWhole &&
                  fullText === undefined
                }
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-ink-soft hover:bg-panel disabled:opacity-40"
              >
                {copied ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto bg-panel/30 p-4">
            {selected === REPORT_TAB ? (
              <div className="space-y-3">
                <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12px] text-ink-soft">
                  <dt>Frontend template</dt>
                  <dd className="font-mono text-[11px]">{templateVersion ?? "Unknown (not recorded)"}</dd>
                </dl>
                <FoundryReport
                  compile={compile}
                  tests={tests}
                  running={running}
                  stage={stage}
                />
                {!compile && !running ? (
                  <p className="text-[12px] text-ink-soft">
                    No compiler report recorded for this build.
                  </p>
                ) : null}
                <div className="rounded-xl border border-line bg-raised p-3 text-[12px] leading-5 text-ink-soft">
                  <p className="font-medium text-ink">Security · Slither</p>
                  {!analysis ? <p>No security report recorded.</p> : null}
                  {analysis && !analysis.ran ? (
                    <p>{analysis.skipped ?? "The scan was skipped."}</p>
                  ) : null}
                  {analysis?.ran ? (
                    <>
                      <p>
                        {analysis.blocking} blocking findings ·{" "}
                        {analysis.findings.length} findings total
                      </p>
                      <ul className="mt-2 space-y-2">
                        {analysis.findings.map(function finding(item, index) {
                          return (
                            <li key={index}>
                              <span className="font-medium">
                                {item.impact} · {item.check}
                              </span>
                              <p className="whitespace-pre-wrap break-words">
                                {item.description}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}
            {selected === ABI_TAB ? (
              <>
                {abiText ? (
                  <CodeText content={abiText} />
                ) : (
                  <p className="text-[12px] text-ink-soft">
                    The ABI appears after a recorded contract compilation.
                  </p>
                )}
              </>
            ) : null}
            {open ? (
              <>
                <CodeText content={content ?? ""} />
                {!previewIsWhole && fullText === undefined ? (
                  <p className="mt-3 text-[11px] text-ink-faint">
                    {loadError ??
                      (running ? "Refreshing file contents…" : "Loading the full file…")}
                    {loadError ? (
                      <button
                        type="button"
                        onClick={function reload() {
                          setRetry(function increment(value) {
                            return value + 1;
                          });
                        }}
                        className="ml-2 underline"
                      >
                        Retry
                      </button>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : null}
            {running && !open && selected !== ABI_TAB ? (
              <p className="mt-3 text-[12px] text-ink-soft">
                {status ?? "Waiting for build events…"}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
