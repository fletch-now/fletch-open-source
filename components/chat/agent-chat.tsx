"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BuildAttachmentsSchema, isImageAttachment } from "@/lib/build/attachments";
import { MAX_PROMPT_CHARS as MAX_PROMPT } from "@/lib/build/prompt-limits";
import { PUBLIC_BUILD_PROMPTS } from "@/lib/build/public-prompts";
import { useHydrated } from "@/lib/use-hydrated";
import { readAttachment } from "@/components/chat/read-attachment";
import { BriefFile } from "@/components/chat/brief-file";
import { ModelChoice, useModelChoice } from "@/components/chat/model-choice";
import { attachmentLimit, briefInstruction, isLongPaste, pastedBrief } from "@/lib/build/pasted-brief";
import { Paperclip, Sparkles, Send } from "@/components/ui/icons";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useHydratedSession } from "@/lib/auth/use-hydrated-session";
import { BuildReply } from "@/components/chat/build-reply";
import { BuildTimeEstimate } from "@/components/chat/build-time-estimate";
import { BuildPriceReview, type BuildPriceQuote } from "@/components/chat/build-price-review";
import { BuildRecovery } from "@/components/chat/build-recovery";
import { BuildBudgetReview } from "@/components/chat/build-budget-review";
import type { QuoteApproval } from "@/lib/build/pricing-quotes";
import type { PricingTier } from "@/lib/build/pricing-policy";
import { Notice } from "@/components/chat/notice";
import { BuildGuide } from "@/components/chat/build-guide";
import type { Stage } from "@/components/chat/pipeline";
import { friendlyError } from "@/lib/errors";
import type { ChatMessage } from "@/lib/chat/types";
import { applyToolResult } from "@/lib/chat/tool-results";
import { retryDraft } from "@/lib/chat/retry-draft";
import type { AnalysisReport, BuildArtifact, BuildAttachment, CompileReport, TestReport } from "@/lib/build/types";
import type { BuildMaintenanceSnapshot } from "@/lib/build/maintenance";
import type { BuildQueueState, QueuedBuildDraft } from "@/lib/build/queue-types";
import type { BuildResult } from "@/components/chat/artifact-panel";

// Only transport silence matters here; the server sends a 15s keepalive even
// while the model is thinking. Reattach after silence without failing the build.
const STALL_MS = 240_000;

function waitToReconnect(signal: AbortSignal, attempt: number): Promise<void> {
  return new Promise(function wait(resolve) {
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    const timer = setTimeout(finish, Math.min(1000 * 2 ** Math.min(attempt, 5), 30_000));
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

interface NeedsFrame {
  contract: boolean;
  wallet: boolean;
  reason: string;
  source: string;
  overridden: boolean;
}

function stageForTool(tool: string): Stage | null {
  switch (tool) {
    case "planning":
      return "planning";
    case "scaffolding":
      return "writing";
    case "compiling":
      return "compiling";
    case "testing":
      return "testing";
    case "deploying":
      return "deploying";
    case "hosting":
      return "hosting";
    default:
      return null;
  }
}

function unfinishedBuild(messages: ChatMessage[] | undefined): ChatMessage | null {
  const running = (messages ?? []).find(function unfinished(message) {
    return message.role === "assistant" && Boolean(message.buildId) && message.phase !== "done";
  });
  return running ?? null;
}
const NEAR_BOTTOM_PX = 150;

function grow(element: HTMLTextAreaElement): void {
  element.style.height = "auto";
  const maximum = Number.parseFloat(getComputedStyle(element).maxHeight);
  element.style.height = `${Math.min(element.scrollHeight, maximum)}px`;
}

// The done frame carries the result as fields. Prose is never parsed for URLs:
// a note explaining why a site is not up mentions its address too.
function resultFrom(data: Record<string, unknown>): BuildResult {
  function text(key: string): string | undefined {
    const value = data[key];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }
  return {
    previewUrl: text("previewUrl"),
    draftReady: data.draftReady === true,
    explorerUrl: text("explorerUrl"),
    contractAddress: text("contractAddress"),
    contractName: text("contractName"),
    verified: typeof data.verified === "boolean" ? data.verified : undefined,
    notes: Array.isArray(data.notes) ? data.notes.filter((note): note is string => typeof note === "string") : undefined,
  };
}

function readQueue(value: unknown): BuildQueueState | null {
  if (!value || typeof value !== "object") return null;
  const queue = value as Record<string, unknown>;
  for (const field of ["position", "ahead", "running", "capacity"]) {
    if (typeof queue[field] !== "number" || !Number.isSafeInteger(queue[field]) || queue[field] < 0) return null;
  }
  if (queue.position === 0 || queue.capacity === 0) return null;
  const reserved = queue.reserved ?? 0;
  if (typeof reserved !== "number" || !Number.isSafeInteger(reserved) || reserved < 0) return null;
  return { ...queue, reserved } as unknown as BuildQueueState;
}

function newId(): string {
  return Math.random().toString(36).slice(2);
}

interface AgentChatProps {
  launcherPrompts?: Array<{ label: string; prompt: string }>;
  // Required: an implicit default silently gave the hero the full-height app
  // layout. "launcher" is the compact hero box that hands the prompt to the app;
  // "app" runs the build and renders the thread.
  mode: "launcher" | "app";
  initialPrompt?: string;
  // Set when opening an existing app: every prompt then continues that project's
  // agent session instead of starting a new app.
  projectId?: string;
  // The project's persisted conversation, rebuilt server-side, so a refresh shows
  // the same thread the stream drew live.
  initialMessages?: ChatMessage[];
  onArtifact?: (artifact: BuildArtifact) => void;
  // The toolchain's verdict, forwarded to whatever surface is rendering it.
  onTemplateVersion?: (version: string | null) => void;
  onCompile?: (report: CompileReport) => void;
  onTests?: (report: TestReport) => void;
  onAnalysis?: (report: AnalysisReport) => void;
  onProjectCreated?: (id: string) => void;
  onResult?: (result: BuildResult) => void;
  onStreamingChange?: (streaming: boolean) => void;
  // The current step and stage, for surfaces outside the console (the files panel).
  onStatusChange?: (status: string | null) => void;
  onStageChange?: (stage: Stage) => void;
  // The needs verdict, once it arrives, for the progress track.
  onNeedsChange?: (needs: { contract: boolean; wallet: boolean; overridden: boolean } | null) => void;
  layout?: "rail" | "reading";
  // A prompt handed in from outside the composer (an action card); the nonce
  // makes the same text sendable twice.
  externalPrompt?: { text: string; nonce: number } | null;
}


export function AgentChat({
  launcherPrompts,
  mode,
  initialPrompt,
  projectId,
  initialMessages,
  onArtifact,
  onTemplateVersion,
  onCompile,
  onTests,
  onAnalysis,
  onProjectCreated,
  onResult,
  onStreamingChange,
  onStatusChange,
  onStageChange,
  onNeedsChange,
  layout = "rail",
  externalPrompt = null,
}: AgentChatProps): React.ReactElement {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [input, setInput] = useState(initialPrompt?.slice(0, MAX_PROMPT) ?? "");
  const hydrated = useHydrated();
  const [enhancing, setEnhancing] = useState(false);
  const [enhancementError, setEnhancementError] = useState<string | null>(null);
  const enhancementRef = useRef<AbortController | null>(null);
  // A thread reopened with a build still running starts in the streaming state
  // and reattaches below, so the console never shows a running build as idle.
  const resuming = mode === "app" && unfinishedBuild(initialMessages) !== null;
  const [isStreaming, setIsStreaming] = useState(resuming);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [budgetPaused, setBudgetPaused] = useState(false);
  const [priceReview, setPriceReview] = useState<{ quote: BuildPriceQuote; prompt: string; sourceInput: string; payload: string; requestId: string } | null>(null);
  const [priceBusy, setPriceBusy] = useState(false);
  const [pricingPublished, setPricingPublished] = useState<boolean | null>(null);
  const priceRequestRef = useRef(false);
  const [reconnecting, setReconnecting] = useState(resuming);
  const [queue, setQueue] = useState<{ buildId: string; state: BuildQueueState } | null>(null);
  const [maintenance, setMaintenance] = useState<{ buildId: string; state: BuildMaintenanceSnapshot } | null>(null);
  const [queueAction, setQueueAction] = useState<"cancel" | "edit" | null>(null);
  const [queueError, setQueueError] = useState<{ assistantId: string; message: string } | null>(null);
  const queueActionRef = useRef<AbortController | null>(null);
  const [stage, setStage] = useState<Stage>(resuming ? "writing" : "idle");
  // The needs verdict for the build in progress: what shape the app takes and
  // whether the agent overrode it.
  const [needs, setNeeds] = useState<NeedsFrame | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [attachments, setAttachments] = useState<BuildAttachment[]>([]);
  const [readingAttachments, setReadingAttachments] = useState(false);
  const [convertedPaste, setConvertedPaste] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Captured from the first build so later prompts read as edits to the same app.
  const projectRef = useRef<string | null>(projectId ?? null);
  const abortRef = useRef<AbortController | null>(null);
  const stallRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Another dashboard boundary can fill the shared auth cache before this
  // streamed console hydrates. Match the server's empty session on its first
  // client render, then reveal the current connection controls after hydration.
  const session = useHydratedSession();
  const modelChoice = useModelChoice(session?.user.id, projectId);
  const unsupportedImages = attachments.some(isImageAttachment) && !modelChoice.acceptsImages;

  useLayoutEffect(function sizePrompt() {
    if (textareaRef.current) grow(textareaRef.current);
  }, [input]);

  useEffect(function followPromptWidth() {
    const element = textareaRef.current;
    if (!element) return;
    let width = element.clientWidth;
    const observer = new ResizeObserver(function resize() {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      grow(element);
    });
    observer.observe(element);
    return function cleanup() { observer.disconnect(); };
  }, []);

  // Follow the stream only when new content arrives AND the reader is already near
  // the bottom. Keyed on message state so focusing the composer never scrolls.
  useEffect(
    function followStream() {
      const el = transcriptRef.current;
      if (!el || messages.length === 0) {
        return;
      }
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distance < NEAR_BOTTOM_PX) {
        endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    },
    [messages, isStreaming],
  );

  useEffect(
    function reportStatus() {
      onStatusChange?.(streamStatus);
    },
    [streamStatus, onStatusChange],
  );

  useEffect(
    function reportStage() {
      onStageChange?.(stage);
    },
    [stage, onStageChange],
  );

  useEffect(
    function reportNeeds() {
      onNeedsChange?.(needs ? { contract: needs.contract, wallet: needs.wallet, overridden: needs.overridden } : null);
    },
    [needs, onNeedsChange],
  );

  useEffect(function readPricingMode() {
    if (mode !== "app" || !session?.user.id) return;
    const controller = new AbortController();
    fetch("/api/build-quotes", { signal: controller.signal, cache: "no-store" })
      .then(async function read(response) { if (response.ok) { const data = await response.json();if (typeof data.published === "boolean") setPricingPublished(data.published); } })
      .catch(function unavailable() { /* The submit-time quote remains authoritative. */ });
    return function cleanup() { controller.abort(); };
  }, [mode, session?.user.id]);

  const externalRef = useRef(0);
  useEffect(
    function sendExternalPrompt() {
      if (!externalPrompt || externalPrompt.nonce === externalRef.current || isStreaming) {
        return;
      }
      externalRef.current = externalPrompt.nonce;
      void send(externalPrompt.text);
    },
    // `send` is recreated every render; the nonce guards against a resend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [externalPrompt, isStreaming],
  );

  // A build runs on the server whether or not anyone is watching. A thread that
  // reopens with an unfinished build reattaches to its stream, which replays
  // every event so far and then follows it live. The cleanup only drops this
  // tab's read; a remount (strict mode does one on purpose) attaches again.
  useEffect(
    function resumeRunningBuild() {
      if (mode !== "app") {
        return;
      }
      const running = unfinishedBuild(initialMessages);
      if (!running?.buildId) {
        return;
      }
      onStreamingChange?.(true);
      void streamBuild(running.buildId, running.id);
      return function detach() {
        abortRef.current?.abort();
      };
    },
    // `streamBuild` and `onStreamingChange` are recreated every render; the
    // thread to resume is fixed by initialMessages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, initialMessages],
  );

  // Leaving the page closes this tab's read of the stream and nothing else: the
  // build keeps running and the next visit reattaches.
  useEffect(function detachOnUnmount() {
    return function detach() {
      abortRef.current?.abort();
      enhancementRef.current?.abort();
      enhancementRef.current = null;
      queueActionRef.current?.abort();
      queueActionRef.current = null;
      if (stallRef.current) {
        clearTimeout(stallRef.current);
      }
    };
  }, []);

  useEffect(function focusShortcut() {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        textareaRef.current?.focus({ preventScroll: true });
      }
    }
    window.addEventListener("keydown", onKey);
    return function cleanup() {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // "Build this one →" on the demos band (components/landing/build-demos) sends
  // the card's prompt here and scrolls up; the launcher just has to take it.
  useEffect(function prefillFromDemoCard() {
    if (mode !== "launcher") {
      return;
    }
    function onPrefill(event: Event): void {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === "string" && detail.length > 0) {
        setInput(detail);
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      }
    }
    window.addEventListener("fletch:prefill", onPrefill);
    return function cleanup() {
      window.removeEventListener("fletch:prefill", onPrefill);
    };
  }, [mode]);

  function patchAssistant(id: string, patch: Partial<ChatMessage>): void {
    setMessages(function apply(previous) {
      return previous.map(function update(message) {
        if (message.id !== id) {
          return message;
        }
        return { ...message, ...patch };
      });
    });
  }

  function clearStall(): void {
    if (stallRef.current) {
      clearTimeout(stallRef.current);
      stallRef.current = null;
    }
  }

  // Every failure path ends the same way: show the error on the assistant
  // bubble and offer a retry, unless canRetry says the user has to act first
  // (e.g. log in) before trying again.
  function failMessage(assistantId: string, error: string, canRetry = true): void {
    patchAssistant(assistantId, { error, phase: "done", canRetry });
  }

  // Streaming UI state that must snap back to idle whenever a build stops,
  // whether it finished, failed, or was cancelled.
  function resetStreaming(): void {
    setStopping(false);
    setPaused(false);
    setBudgetPaused(false);
    setIsStreaming(false);
    onStreamingChange?.(false);
    setStreamStatus(null);
    setQueue(null);
  }

  async function streamBuild(buildId: string, assistantId: string): Promise<void> {
    const controller = new AbortController();
    abortRef.current = controller;
    setIsStreaming(true);
    setReconnecting(true);
    let completed = false;
    let attempt = 0;
    let displayedSteps = messages.find((message) => message.id === assistantId)?.toolCalls.length ?? 0;
    let lastEventId = "";
    let toolCalls: ChatMessage["toolCalls"] = [];
    let answer = "";

    try {
      while (!controller.signal.aborted) {
        // Worker cursors continue the transcript; legacy attachments replay it.
        if (!lastEventId) { toolCalls = []; answer = ""; }
        const requestController = new AbortController();

        function showRecordedSteps(): void {
          // Keep the already visible history while a replay arrives in chunks.
          if (toolCalls.length < displayedSteps) return;
          displayedSteps = toolCalls.length;
          patchAssistant(assistantId, { toolCalls: [...toolCalls] });
        }

        function armStall(): void {
          clearStall();
          stallRef.current = setTimeout(function onStall() {
            requestController.abort();
          }, STALL_MS);
        }

        try {
          armStall();
          const response = await fetch(`/api/builds/${buildId}/stream`, {
            signal: AbortSignal.any([controller.signal, requestController.signal]),
            headers: lastEventId ? { "Last-Event-ID": lastEventId } : undefined,
          });
          if (controller.signal.aborted) break;
          if (!response.ok || !response.body) {
            if (response.status >= 500 || response.status === 408 || response.status === 429) {
              throw new Error("Build stream unavailable");
            }
            const payload = await response.json().catch(function ignore() { return null; });
            if (payload?.requiresLogin) setNeedsLogin(true);
            failMessage(assistantId, payload?.error ?? "The build stream is unavailable.", false);
            break;
          }
          setReconnecting(false);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          armStall();

          while (true) {
            const { done, value } = await reader.read();
            if (done || controller.signal.aborted) {
              break;
            }
            armStall();
            buffer += decoder.decode(value, { stream: true });
            const frames = buffer.split("\n\n");
            buffer = frames.pop() ?? "";

            for (const raw of frames) {
              // Skip blank frames and ":" heartbeats, which would corrupt the buffer.
              if (!raw.trim() || raw.startsWith(":")) {
                continue;
              }
              let eventType = "message";
              let dataStr = "";
              let frameId = "";
              for (const line of raw.split("\n")) {
                if (line.startsWith("event: ")) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  dataStr = line.slice(6);
                } else if (line.startsWith("id: ")) {
                  frameId = line.slice(4).trim();
                }
              }
              if (!dataStr) {
                continue;
              }
              let data: Record<string, string>;
              try {
                data = JSON.parse(dataStr);
              } catch {
                continue;
              }

              if (eventType === "status") {
                if (data.buildState === "stopping") setStopping(true);
                setPaused(data.buildState === "paused" || data.buildState === "paused_budget");
                setBudgetPaused(data.buildState === "paused_budget");
                if (data.buildState) setQueue(null);
                setStreamStatus(data.step);
                const update = data.maintenance as unknown as BuildMaintenanceSnapshot | null;
                setMaintenance(update && (update.phase === "draining" || update.phase === "updating") && typeof update.stale === "boolean" ? { buildId, state: update } : null);
                const state = readQueue(data.queue);
                if (state) {
                  setQueue({ buildId, state });
                  setStage("idle");
                }
              } else if (eventType === "phase") {
                setPaused(false);
                setBudgetPaused(false);
                setQueue(null);
                if (dataStr === '"planning"' || data.phase === "planning") setStage("planning");
                if (dataStr.includes("answering")) {
                  setStreamStatus(null);
                  patchAssistant(assistantId, { phase: "answering" });
                }
              } else if (eventType === "tool_use") {
                setQueue(null);
                const next = stageForTool(data.tool);
                if (next) {
                  setStage(next);
                }
                const stamped = typeof data.at === "string" ? Date.parse(data.at) : Number.NaN;
                toolCalls.push({ id: data.id, tool: data.tool, input: data.input, at: Number.isFinite(stamped) ? stamped : Date.now() });
                showRecordedSteps();
              } else if (eventType === "tool_result") {
                const result: Record<string, unknown> = data;
                applyToolResult(toolCalls, {
                  id: typeof result.id === "string" ? result.id : undefined,
                  summary: typeof result.summary === "string" ? result.summary : "",
                  output: typeof result.output === "string" ? result.output : undefined,
                  outputTruncated: result.outputTruncated === true,
                  outputChars: typeof result.outputChars === "number" && Number.isFinite(result.outputChars) ? result.outputChars : undefined,
                });
                showRecordedSteps();
              } else if (eventType === "note") {
                // What the agent said while working, shown as its own step rather
                // than folded into the final answer, which is written at the end.
                const stampedNote = typeof data.at === "string" ? Date.parse(data.at) : Number.NaN;
                toolCalls.push({ tool: "note", input: data.content, at: Number.isFinite(stampedNote) ? stampedNote : Date.now(), summary: "said" });
                showRecordedSteps();
              } else if (eventType === "text") {
                answer += data.content;
                patchAssistant(assistantId, { content: answer, phase: "answering" });
              } else if (eventType === "needs") {
                setNeeds(data as unknown as NeedsFrame);
              } else if (eventType === "artifact") {
                onArtifact?.(data as unknown as BuildArtifact);
              } else if (eventType === "template") {
                onTemplateVersion?.(typeof data.version === "string" ? data.version : null);
              } else if (eventType === "compile") {
                onCompile?.(data as unknown as CompileReport);
              } else if (eventType === "tests") {
                onTests?.(data as unknown as TestReport);
              } else if (eventType === "analysis") {
                onAnalysis?.(data as unknown as AnalysisReport);
              } else if (eventType === "text_bulk") {
                answer = data.content;
                patchAssistant(assistantId, { content: answer, phase: "answering" });
              } else if (eventType === "error") {
                completed = true;
                failMessage(assistantId, data.message);
              } else if (eventType === "done") {
                completed = true;
                setStage("done");
                patchAssistant(assistantId, { phase: "done" });
                onResult?.(resultFrom(data as Record<string, unknown>));
              }
              if (frameId) lastEventId = frameId;
            }
            if (completed) {
              await reader.cancel();
              break;
            }
          }
        } catch {
          // Losing this subscription says nothing about the server's build.
          // Retry the read while keeping the draft, recorded steps and run ID.
        } finally {
          if (abortRef.current === controller) clearStall();
        }
        if (completed || controller.signal.aborted) break;
        setReconnecting(true);
        await waitToReconnect(controller.signal, attempt);
        attempt += 1;
      }
    } finally {
      if (abortRef.current === controller) {
        clearStall();
        abortRef.current = null;
        resetStreaming();
        if (completed) router.refresh();
      }
    }
  }

  async function send(prompt: string, approval?: QuoteApproval, tier: PricingTier = "small"): Promise<void> {
    const trimmed = prompt.trim();
    if (trimmed.length < MIN_PROMPT || trimmed.length > MAX_PROMPT || isStreaming || enhancing || enhancementRef.current || queueActionRef.current) {
      return;
    }
    if (mode === "launcher") {
      router.push(`/dashboard/build?p=${encodeURIComponent(trimmed)}`);
      return;
    }
    if (!session) {
      setNeedsLogin(true);
      return;
    }
    if (readingAttachments) return;
    if (unsupportedImages) {
      toast.error("Choose an image-capable model connection or remove the images before building.");
      return;
    }
    if (!modelChoice.ready || !modelChoice.selection) {
      toast.error("Choose an available model connection before building.");
      return;
    }
    const requestPayload = { prompt: trimmed, projectId: projectRef.current ?? undefined,
      attachments: attachments.length > 0 ? attachments : undefined, selection: modelChoice.selection };
    if (priceRequestRef.current) return;
    if (approval && (priceReview?.payload !== JSON.stringify(requestPayload) || priceReview?.sourceInput !== input)) {
      setPriceReview(null);
      toast.error("Your draft or connection changed. Review a fresh quote.");
      return;
    }
    if (!approval) {
      priceRequestRef.current = true;
      setPriceBusy(true);
      try {
        const quoteResponse = await fetch("/api/build-quotes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestPayload, tier }) });
        const quote = await quoteResponse.json();
        if (!quoteResponse.ok) throw new Error(quote.error ?? "Could not review the build price.");
        setPricingPublished(!quote.legacy);
        if (!quote.legacy) {
          setPriceReview({ quote, prompt, sourceInput: input, payload: JSON.stringify(requestPayload), requestId: crypto.randomUUID() });
          return;
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not reach the server.");
        return;
      } finally { priceRequestRef.current = false;setPriceBusy(false); }
    }
    abortRef.current?.abort();
    setNeedsLogin(false);
    setQueueError(null);

    const assistantId = newId();
    setMessages(function append(previous) {
      return [
        ...previous,
        { id: newId(), role: "user", content: trimmed, attachments: [...attachments], toolCalls: [], phase: "done" },
        { id: assistantId, role: "assistant", content: "", toolCalls: [], phase: "planning" },
      ];
    });
    setIsStreaming(true);
    onStreamingChange?.(true);
    setStage("writing");
    setNeeds(null);
    setStreamStatus("starting");

    const response = await fetch("/api/builds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestPayload, approval }),
    }).catch(function ignore() {
      return null;
    });

    if (!response) {
      toast.error(friendlyError(null, "Could not reach the server."));
      failMessage(assistantId, "Could not reach the server.");
      resetStreaming();
      return;
    }

    const payload = await response.json().catch(function ignore() {
      return {};
    });
    if (!response.ok) {
      if (response.status === 401) {
        setNeedsLogin(true);
      }
      if (payload.requote) setPriceReview(null);
      const message = response.status === 503 ? "The builder is temporarily unavailable. Your prompt and attachments are still in the composer. Try again shortly." : payload.error ?? "The build could not start.";
      failMessage(assistantId, message, response.status !== 401);
      resetStreaming();
      return;
    }

    setPriceReview(null);
    setInput(function clearAcceptedDraft(draft) {
      return draft === prompt ? "" : draft;
    });
    setAttachments([]);
    setConvertedPaste(false);
    if (payload.projectId) {
      const isNewProject = projectRef.current !== payload.projectId;
      projectRef.current = payload.projectId;
      // Pin the URL to the project as soon as it exists, so a refresh mid-build
      // reopens this same conversation instead of a blank console.
      if (mode === "app" && isNewProject) {
        modelChoice.rememberProject(payload.projectId);
        onProjectCreated?.(payload.projectId);
        router.replace(`/dashboard/build?project=${payload.projectId}`, { scroll: false });
      }
    }
    patchAssistant(assistantId, { buildId: payload.buildId });
    await streamBuild(payload.buildId, assistantId);
  }

  function cancelEnhancement(): void {
    enhancementRef.current?.abort();
    enhancementRef.current = null;
    setEnhancing(false);
  }

  async function enhance(): Promise<void> {
    const original = input;
    const draft = original.trim();
    if (draft.length < 4 || isStreaming || enhancementRef.current) return;
    const controller = new AbortController();
    enhancementRef.current = controller;
    setEnhancementError(null);
    setEnhancing(true);
    try {
      const response = await fetch("/api/prompts/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: draft }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(function ignore() { return null; });
      if (enhancementRef.current !== controller) return;
      if (response.status === 401) {
        setNeedsLogin(true);
        setEnhancementError("Sign in again to enhance this prompt. Your draft is unchanged.");
        return;
      }
      if (!response.ok) {
        const fallback = response.status === 422
          ? "Enhancement could not produce a usable prompt. Add more detail or build your draft as written."
          : "Could not enhance the prompt right now. Try again or build your draft as written.";
        setEnhancementError(typeof payload?.error === "string" ? payload.error : fallback);
        return;
      }
      if (typeof payload?.prompt !== "string" || !payload.prompt.trim() || payload.prompt.length > MAX_PROMPT) {
        setEnhancementError("Enhancement returned an unusable prompt. Your draft is unchanged; try again or build it as written.");
        return;
      }
      // A late result cannot replace edits or a different draft supplied elsewhere.
      setInput(function applyToOriginal(current) { return current === original ? payload.prompt : current; });
      textareaRef.current?.focus();
    } catch {
      if (enhancementRef.current === controller && !controller.signal.aborted) {
        setEnhancementError("Could not reach prompt enhancement. Your draft is unchanged; try again or build it as written.");
      }
    } finally {
      if (enhancementRef.current === controller) {
        enhancementRef.current = null;
        setEnhancing(false);
      }
    }
  }

  async function changeQueuedBuild(action: "cancel" | "edit", assistantId: string, buildId: string): Promise<void> {
    if (queueActionRef.current || queue?.buildId !== buildId) return;
    if (action === "edit" && (input.trim() || attachments.length > 0)) {
      setQueueError({ assistantId, message: "Keep or clear the current draft before editing the queued prompt." });
      return;
    }
    const controller = new AbortController();
    const requestProject = projectRef.current;
    queueActionRef.current = controller;
    setQueueAction(action);
    setQueueError(null);
    try {
      const response = await fetch(`/api/builds/${buildId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queuedOnly: true }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const body = await response.json().catch(() => null) as { stopped?: boolean; draft?: QueuedBuildDraft | null; refunded?: boolean; error?: string } | null;
      if (queueActionRef.current !== controller || controller.signal.aborted || projectRef.current !== requestProject) return;
      if (!response.ok || body?.stopped !== true) {
        if (response.status === 409) {
          setQueue(null);
          setStage("planning");
        }
        setQueueError({ assistantId, message: response.status === 409 ? "This build has already started. Your draft is unchanged." : body?.error ?? "Could not cancel the queue. Your draft is unchanged; try again." });
        return;
      }
      const stream = abortRef.current;
      abortRef.current = null;
      stream?.abort();
      clearStall();
      resetStreaming();
      setStage("idle");
      const refunded = body.refunded === true && body.draft?.selection?.billingMode === "platform";
      patchAssistant(assistantId, { phase: "done", content: refunded ? "Removed from the queue. Reserved credit refunded." : "Removed from the queue.", error: undefined, canRetry: false });
      if (action === "edit") {
        const draft = body.draft;
        if (!draft || typeof draft.prompt !== "string" || draft.projectId !== requestProject || !BuildAttachmentsSchema.safeParse(draft.attachments).success || !draft.selection || !["platform", "own_key"].includes(draft.selection.billingMode)) {
          setQueueError({ assistantId, message: "The queue was cancelled, but its saved draft or model connection could not be restored. Your original prompt and attachments remain in the conversation. Choose a connection before submitting again." });
          return;
        }
        setInput(draft.prompt);
        setAttachments(draft.attachments);
        setConvertedPaste(false);
        modelChoice.restore(draft.selection);
        textareaRef.current?.focus({ preventScroll: true });
      }
      router.refresh();
    } catch {
      if (queueActionRef.current === controller && !controller.signal.aborted) {
        setQueueError({ assistantId, message: "Could not confirm queue cancellation. Your draft is unchanged; reconnect and try again." });
      }
    } finally {
      if (queueActionRef.current === controller) {
        queueActionRef.current = null;
        setQueueAction(null);
      }
    }
  }

  // Stop ends the build on the server too: closing the stream alone left the
  // container running, charged for, and holding the one-build-at-a-time slot.
  // Stop asks the server to end the build and leaves the stream open, so the
  // server's terminal event closes the message after actual cleanup.
  const [stopping, setStopping] = useState(false);
  async function stop(): Promise<void> {
    const running = messages.find(function streaming(message) {
      return message.role === "assistant" && message.buildId && message.phase !== "done";
    });
    if (!running?.buildId) {
      abortRef.current?.abort();
      resetStreaming();
      return;
    }
    setStopping(true);
    const response = await fetch(`/api/builds/${running.buildId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queuedOnly: false }),
      signal: AbortSignal.timeout(15_000),
    }).catch(function ignore() {
      return null;
    });
    const body = (await response?.json().catch(function ignore() {
      return null;
    })) as { accepted?: boolean; stopped?: boolean; error?: string } | null;
    if (!response || !response.ok || (!body?.accepted && body?.stopped !== true)) {
      setStopping(false);
      toast.error(body?.error ?? "Could not confirm the stop request. Reconnect and try again.");
      return;
    }
    toast.info("Stop requested. Waiting for active work to finish stopping; any transaction already sent will be recorded.");
  }

  function restoreRetry(assistantId: string): void {
    if (isStreaming || enhancing || readingAttachments || priceBusy || queueActionRef.current) return;
    if (input.trim() || attachments.length > 0) {
      toast.error("Keep or clear the current draft before restoring this build's prompt.");
      return;
    }
    const draft = retryDraft(messages, assistantId);
    if (!draft) return;
    setInput(draft.prompt);
    setAttachments(draft.attachments);
    setConvertedPaste(false);
    setPriceReview(null);
    textareaRef.current?.focus({ preventScroll: true });
  }

  const hasThread = messages.length > 0 || mode === "app";
  // Mirrors the server's zod rule, so a too-short prompt never round-trips to a 400.
  const MIN_PROMPT = 8;
  const promptLength = input.trim().length;
  const tooShort = promptLength > 0 && promptLength < MIN_PROMPT;
  const tooLong = promptLength > MAX_PROMPT;

  async function addFiles(files: FileList | null): Promise<void> {
    if (!files?.length || readingAttachments || isStreaming) return;
    setReadingAttachments(true);
    const accepted: BuildAttachment[] = [];
    for (const file of Array.from(files)) {
      try { accepted.push(await readAttachment(file)); }
      catch (error) { toast.error(error instanceof Error ? error.message : `Could not read ${file.name}.`); }
    }
    setAttachments(function merge(previous) {
      const merged = [...previous, ...accepted];
      const error = attachmentLimit(merged);
      if (error) { toast.error(error); return previous; }
      return merged;
    });
    setReadingAttachments(false);
  }

  function removeAttachment(name: string): void {
    setAttachments(function drop(previous) {
      return previous.filter((file) => file.name !== name);
    });
  }

  let buildButtonLabel = "Ship · Review cost";
  if (pricingPublished === false) buildButtonLabel = "Ship · 1 credit";
  if (modelChoice.selection?.billingMode === "own_key") buildButtonLabel = "Ship · 0 credits";

  const canSend = !priceBusy && promptLength >= MIN_PROMPT && !tooLong && !isStreaming && !enhancing && !queueAction && modelChoice.ready && modelChoice.selection !== null && !unsupportedImages && !readingAttachments;

  return (
    <div
      inert={!hydrated}
      className={`flex w-full flex-col gap-3 ${mode === "launcher" ? "" : "h-full min-h-0"}`}
    >
      {/* In app mode this is not a card: it fills the workspace column at a fixed
          height and only the transcript inside it scrolls, so the console never
          changes size as messages stream in. */}
      <div
        className={`flex min-h-0 flex-col overflow-hidden ${
          mode === "launcher" && hasThread ? "rounded-2xl border border-white/10 bg-[#121211]" : ""
        } ${hasThread ? "h-full" : ""}`}
      >
        {hasThread ? (
          <>
            <div ref={transcriptRef} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain py-6 text-left ${mode === "launcher" ? "px-3 sm:px-4" : "px-4 sm:px-5"}`}>
              <div className={`flex min-w-0 flex-col gap-8 ${layout === "reading" ? "mx-auto w-full max-w-[760px]" : ""}`}>
                {messages.length === 0 ? (
                  <BuildGuide
                    prompts={PUBLIC_BUILD_PROMPTS}
                    onPick={function pick(prompt) {
                      setInput(prompt);
                      textareaRef.current?.focus();
                    }}
                  />
                ) : null}
                {messages.map(function renderMessage(message) {
                  if (message.role === "user") {
                    return (
                      <div key={message.id} className="rise flex justify-end">
                        <div className="flex w-full max-w-[92%] min-w-0 flex-col gap-2">
                          {isLongPaste(message.content) ? <BriefFile file={{ name: "original-prompt.txt", content: message.content }} /> : <p className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-panel px-3.5 py-2 text-[14px] leading-6 text-ink">{message.content}</p>}
                          {message.attachments?.map((file) => <BriefFile key={file.name} file={file} />)}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={message.id} data-build-reply={message.buildId ?? message.id} className="rise flex min-w-0 flex-col items-start gap-3">
                      <BuildReply toolCalls={message.toolCalls} content={message.content} buildId={message.buildId} active={message.phase !== "done"} status={message.phase !== "done" ? streamStatus : null} reconnecting={reconnecting} paused={message.phase !== "done" && paused && !stopping}
                        maintenance={message.phase !== "done" && !stopping && maintenance && maintenance.buildId === message.buildId ? maintenance.state : null}
                        queue={message.phase !== "done" && queue && queue.buildId === message.buildId ? queue.state : null}
                        queueBusy={queueAction !== null}
                        onCancelQueue={() => { if (message.buildId) void changeQueuedBuild("cancel", message.id, message.buildId); }}
                        onEditQueuedPrompt={() => { if (message.buildId) void changeQueuedBuild("edit", message.id, message.buildId); }}
                      />
                      {message.phase !== "done" && paused && !budgetPaused && message.buildId && !stopping ? <BuildRecovery buildId={message.buildId} onResumed={() => { setPaused(false);setStreamStatus("Saved progress is queued to continue."); }} /> : null}
                      {message.phase !== "done" && budgetPaused && message.buildId && !stopping ? <BuildBudgetReview buildId={message.buildId} onResumed={() => { setBudgetPaused(false);setPaused(false);setStreamStatus("Allowance approved. Waiting for a build slot."); }} /> : null}
                      {queueError?.assistantId === message.id ? <Notice tone="error">{queueError.message}</Notice> : null}
                      {message.error ? (
                        <Notice
                          tone="error"
                          action={
                            message.canRetry ? (
                              <button
                                type="button"
                                onClick={() => restoreRetry(message.id)}
                                className="flex h-11 shrink-0 items-center justify-center rounded-full border border-amber-400/60 px-4 text-[12px] font-medium transition-colors hover:bg-amber-100"
                              >
                                Restore draft
                              </button>
                            ) : null
                          }
                        >
                          {message.error}
                        </Notice>
                      ) : null}
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            </div>
          </>
        ) : null}

        <div className={`${mode === "app" ? "max-h-[65%] shrink-0 overflow-y-auto overscroll-contain px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-4 sm:pb-4" : "shrink-0"} ${mode === "launcher" && hasThread ? "border-t border-line bg-panel/40 p-3 sm:px-6 sm:py-4" : ""}`}>
          <div className={layout === "reading" ? "mx-auto w-full max-w-[760px]" : "min-w-0"}>
          {needsLogin ? (
            <div className="mb-2 flex justify-center">
              <Notice>Connect a wallet to start building.</Notice>
            </div>
          ) : null}
          {priceReview ? <BuildPriceReview quote={priceReview.quote} busy={priceBusy || isStreaming}
            onTier={(tier) => { void send(priceReview.prompt, undefined, tier); }}
            onCancel={() => setPriceReview(null)}
            onApprove={() => { void send(priceReview.prompt, { quoteId: priceReview.quote.id, digest: priceReview.quote.digest, requestId: priceReview.requestId }); }} /> : null}
          {mode === "app" && session && !isStreaming && modelChoice.ready && !modelChoice.error && modelChoice.selection && input.trim().length >= 8 ? (
            <BuildTimeEstimate
              provider={modelChoice.selection.billingMode === "own_key" ? modelChoice.selection.provider : undefined}
              model={modelChoice.selection.billingMode === "own_key" ? modelChoice.selection.model : undefined}
            />
          ) : null}
          <form
            aria-busy={enhancing || priceBusy || queueAction !== null}
            onSubmit={function onSubmit(event) {
              event.preventDefault();
              send(input);
            }}
            onDragOver={function onDragOver(event) {
              event.preventDefault();
            }}
            onDrop={function onDrop(event) {
              event.preventDefault();
              void addFiles(event.dataTransfer.files);
            }}
            className={`flex gap-3 transition-colors ${
              mode === "launcher"
                ? "items-end rounded-2xl border border-white/10 bg-[#141412] py-3 pl-5 pr-2.5 focus-within:border-white/25 sm:pl-6"
                : "flex-col rounded-2xl border border-line bg-raised p-3 focus-within:border-hood/60"
            }`}
          >
          {attachments.length > 0 ? (
            <div className="flex max-h-32 min-w-0 flex-col gap-2 overflow-y-auto">
              {attachments.map((file) => <BriefFile key={file.name} file={file} onRemove={() => removeAttachment(file.name)} />)}
              <span className="text-xs text-ink-faint">Attached as build context. Open an attachment to review it.</span>
            </div>
          ) : null}
          {unsupportedImages ? <p role="status" className="pb-3 text-sm text-amber-700">Choose an image-capable model connection or remove the images before building.</p> : null}
          {readingAttachments ? <p role="status" className="pb-3 text-xs text-ink-faint">Reading attachments…</p> : null}
            <textarea
              ref={textareaRef}
              value={input}
              readOnly={queueAction !== null}
              rows={3}
              wrap="soft"
              aria-label="Build prompt"
              aria-describedby={mode === "app" ? "build-prompt-help" : undefined}
              onChange={function onChange(event) {
                cancelEnhancement();
                setEnhancementError(null);
                setInput(event.target.value);
              }}
              onPaste={function paste(event) {
                if (queueActionRef.current) { event.preventDefault(); return; }
                if (mode !== "app") return;
                cancelEnhancement();
                setEnhancementError(null);
                if (event.clipboardData.files.length > 0) {
                  event.preventDefault();
                  void addFiles(event.clipboardData.files);
                  return;
                }
                const text = event.clipboardData.getData("text/plain");
                if (!isLongPaste(text)) return;
                const file = pastedBrief(text, attachments);
                const error = attachmentLimit([...attachments, file]);
                if (error) {
                  toast.error(`${error} Your pasted text will stay in the editor.`);
                  return;
                }
                event.preventDefault();
                setConvertedPaste(true);
                const start = event.currentTarget.selectionStart;
                const end = event.currentTarget.selectionEnd;
                const instruction = briefInstruction(file.name);
                setAttachments((files) => [...files, file]);
                setInput((draft) => `${draft.slice(0, start)}${instruction}${draft.slice(end)}`);
              }}
              onKeyDown={function onKeyDown(event) {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
                event.preventDefault();
                if (!event.repeat) void send(input);
              }}
              placeholder={mode === "app" ? "Describe the change you want made to this app" : "Describe the app you want built on Robinhood Chain"}
              className={`block min-w-0 resize-none overflow-x-hidden whitespace-pre-wrap break-words bg-transparent text-left text-[16px] focus:outline-none ${
                mode === "launcher"
                  ? "max-h-[180px] min-h-[72px] flex-1 text-[14.5px] leading-6 text-[#ece8de] placeholder:text-[#a9a69c] sm:text-[15px]"
                  : "max-h-[min(240px,30dvh)] min-h-[72px] sm:min-h-[120px] w-full leading-6 text-ink placeholder:text-ink-faint"
              }`}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".png,.jpg,.jpeg,.md,.markdown,.txt,.csv,.json,.yml,.yaml,image/png,image/jpeg"
              className="hidden"
              onChange={function onPick(event) {
                void addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <div className={mode === "app" ? "flex w-full min-w-0 items-center gap-1" : "flex shrink-0 items-end gap-1"}>
              {isStreaming ? null : (
                <button
                  type="button"
                  onClick={function openPicker() {
                    fileInputRef.current?.click();
                  }}
                  title="Attach files: 5 text files, 64 KB each; 3 PNG/JPEG images, 2 MB each"
                  disabled={readingAttachments}
                  className={`grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood ${
                    mode === "launcher" ? "text-[#a9a69c] hover:bg-white/10 hover:text-[#ece8de]" : "text-ink-soft hover:bg-panel hover:text-ink"
                  }`}
                  aria-label="Attach a file"
                >
                  <Paperclip className="h-5 w-5" />
                </button>
              )}
              {mode === "app" && !isStreaming ? (
                <button
                  type="button"
                  onClick={enhance}
                  disabled={enhancing || input.trim().length < 4}
                  title={enhancing ? "Enhancing prompt…" : "Enhance prompt"}
                  aria-label={enhancing ? "Enhancing prompt" : "Enhance prompt"}
                  aria-busy={enhancing}
                  className="grid h-11 w-11 sm:h-9 sm:w-9 shrink-0 place-items-center rounded-lg text-ink-soft transition-colors hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className={`h-5 w-5 ${enhancing ? "motion-safe:animate-pulse" : ""}`} />
                </button>
              ) : null}
              {mode === "app" && session ? <ModelChoice choice={modelChoice} disabled={isStreaming} /> : null}
              {isStreaming && queue ? <span className="ml-auto text-xs text-ink-faint">Queued</span> : null}
              {isStreaming && !queue ? (
                <button
                  type="button"
                  onClick={function onStop() {
                    void stop();
                  }}
                  disabled={stopping}
                  title={stopping ? "Stopping the build" : "Stop the build"}
                  className={`ml-auto flex h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-[12.5px] font-medium transition-colors ${
                    stopping ? "bg-amber-50 text-amber-700" : "bg-panel text-ink-soft hover:bg-line"
                  }`}
                  aria-label={stopping ? "Stopping build" : "Stop"}
                  aria-busy={stopping}
                >
                  <span className="block h-3 w-3 rounded-[2px] bg-current" />
                  {stopping ? "Stopping…" : "Stop"}
                </button>
              ) : null}
              {!isStreaming ? (
                <button
                  type="submit"
                  disabled={!canSend}
                  className={`shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood disabled:cursor-not-allowed ${
                    mode === "launcher"
                      ? "h-11 rounded-full bg-[#c4f26a] px-6 text-[15px] font-medium text-black hover:bg-[#d3f98a] disabled:bg-[#c4f26a]/40 disabled:text-black/60"
                      : "ml-auto flex h-11 sm:h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-hood px-2.5 text-xs font-medium text-black hover:bg-hood-strong disabled:border disabled:border-line disabled:bg-panel disabled:text-ink-faint"
                  }`}
                  aria-label={mode === "launcher" ? "Ship: open prompt in Build" : `Send prompt: ${buildButtonLabel}`}
                  title="Send prompt (Enter); Shift + Enter for a new line"
                >
                    {mode === "launcher" ? "Ship" : <><Send className="hidden h-4 w-4 xl:block" /><span>{buildButtonLabel}</span></>}
                </button>
              ) : null}
            </div>
          </form>
          {enhancing ? (
            <div className="flex items-center justify-between gap-2 px-1 pt-2 text-xs text-ink-soft">
              <span role="status" className="flex min-w-0 items-center gap-2"><span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin" />Enhancing prompt… Editing cancels enhancement.</span>
              <button type="button" onClick={cancelEnhancement} className="shrink-0 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-hood" aria-label="Cancel enhancement">Cancel</button>
            </div>
          ) : null}
          {enhancementError ? <p role="alert" className="px-1 pt-2 text-xs text-amber-700">{enhancementError}</p> : null}

          <div id={mode === "app" ? "build-prompt-help" : undefined} className="sr-only">
            Enter to send. Shift + Enter for a new line. Ctrl or Command + Enter also sends. Ctrl or Command + K to focus.
            Text files: 5 maximum, 64 KB each, 128 KB total. PNG/JPEG images: 3 maximum, 2 MB each, 4 MB total, 4096 pixels per side.
          </div>
          {tooLong ? <p role="status" className="pt-2 text-xs text-amber-700">The limit is 24,000 characters. Attach the prompt as a file instead.</p> : null}
          {mode === "launcher" ? <p className="pt-2 text-xs text-night-faint">Opens your prompt in Build. Review it there, then click Ship to start.</p> : null}
          {mode === "app" && initialPrompt && !hasThread ? <p className="pt-2 text-xs text-ink-faint">Your prompt is ready to edit. Click Ship when you want to start the build.</p> : null}
          {tooShort ? <p role="status" className="pt-2 text-xs text-ink-faint">{MIN_PROMPT - promptLength} more characters to send.</p> : null}
          {mode === "app" && (input.length > MAX_PROMPT / 2 || convertedPaste) ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-2 text-[11px] text-ink-faint">
              {input.length > MAX_PROMPT / 2 ? <span className="font-mono tabular-nums">{input.length.toLocaleString("en-US")} / 24,000</span> : null}
              {convertedPaste ? <span>Long paste saved as a text file.</span> : null}
            </div>
          ) : null}
          </div>
        </div>
      </div>

      {/* Suggestions live outside the card so the empty state stays a single compact box */}
      {hasThread ? null : (
        <div className="flex flex-wrap items-center gap-2">
          {(launcherPrompts ?? PUBLIC_BUILD_PROMPTS).map(function renderPrompt(item) {
            return (
              <button
                key={item.label}
                type="button"
                onClick={function pick() {
                  setInput(item.prompt);
                  textareaRef.current?.focus();
                }}
                title={item.prompt}
                className={`inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-full bg-white/[0.06] text-[13px] leading-none transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hood ${mode === "launcher" ? "border border-white/[0.12] px-3 text-[#e8e4da] hover:border-white/25" : "px-3.5 text-[#d8d4ca]"}`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
