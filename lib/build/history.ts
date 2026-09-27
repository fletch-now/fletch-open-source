import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { auditLog, buildLogs, builds, projects } from "@/lib/db/schema";
import type { ChatMessage } from "@/lib/chat/types";
import { recordedBuildSteps } from "@/lib/build/history-steps";
import { updateBuildEvidence } from "@/lib/chat/build-evidence";
import type { AnalysisReport, BuildArtifact, BuildEvent, CompileReport, TestReport } from "@/lib/build/types";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";

// Every build event is persisted as JSON, so a finished build can be reconstructed
// long after its stream closed — which is what a project page needs to show the
// toolchain result without re-running anything.
export interface BuildSummary {
  templateVersion: string | null;
  compile: CompileReport | null;
  tests: TestReport | null;
  analysis: AnalysisReport | null;
  artifacts: BuildArtifact[];
}

export async function summariseBuild(buildId: string): Promise<BuildSummary> {
  const rows = await db
    .select({ chunk: buildLogs.chunk })
    .from(buildLogs)
    .where(eq(buildLogs.buildId, buildId))
    .orderBy(asc(buildLogs.seq));

  const summary: BuildSummary = { templateVersion: null, compile: null, tests: null, analysis: null, artifacts: [] };
  for (const row of rows) {
    if (!row.chunk) {
      continue;
    }
    let event: BuildEvent;
    try {
      event = JSON.parse(row.chunk) as BuildEvent;
    } catch {
      continue;
    }
    // Later reports supersede earlier ones: a repair round recompiles.
    if (event.templateVersion) {
      summary.templateVersion = event.templateVersion;
    }
    Object.assign(summary, updateBuildEvidence(summary, event));
    if (event.artifact) {
      summary.artifacts.push(event.artifact);
    }
  }
  return summary;
}

// A project's whole conversation, rebuilt from what the runner persisted: every
// prompt is a build row, every step and answer is a build event. This is what lets
// a refresh — or a return next week — show the same thread the stream drew live.
export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  buildCount: number;
  previewUrl: string | null;
}

export async function listProjectsWithCounts(userId: string): Promise<ProjectRow[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      createdAt: projects.createdAt,
      previewUrl: projects.previewUrl,
      buildCount: sql<string>`count(${builds.id})`,
    })
    .from(projects)
    .leftJoin(builds, eq(builds.projectId, projects.id))
    .where(eq(projects.userId, userId))
    .groupBy(projects.id)
    .orderBy(desc(projects.createdAt));
  return rows.map(function shape(row) {
    return { ...row, buildCount: Number(row.buildCount) };
  });
}

const STALE_HOSTING_NOTE = /^The site is written but .*$/m;

// The done event is the record of one run. The project's address can change
// after it (an operator published the written site), so the latest build's
// answer is told the current URL and drops the note that no longer holds.
function answerFor(event: BuildEvent, liveUrl: string | null): string {
  let text = event.text.trim() || "Build complete.";
  const url = event.previewUrl ?? liveUrl;
  if (url && !event.previewUrl) {
    text = text.replace(STALE_HOSTING_NOTE, "").replace(/\n{3,}/g, "\n\n").trim();
  }
  const lines = [text];
  if (url) {
    lines.push(event.draftReady ? `\nPublished site, which may show an earlier version: ${url}` : `\nLive at ${url}`);
  }
  if (event.contractAddress) {
    lines.push(`Contract on testnet: ${event.contractAddress}`);
  }
  return lines.join("\n");
}

// A build only counts as retryable once we know it stopped without an answer.
// `undefined` here means "nothing wrong to show"; a defined string always means
// canRetry should be true, so the two are derived from the same value below.
function errorTextFor(
  row: { error: string | null },
  doneEvent: BuildEvent | undefined,
  errorEvent: BuildEvent | undefined,
  stillRunning: boolean,
): string | undefined {
  if (errorEvent) {
    return errorEvent.text;
  }
  if (doneEvent || stillRunning) {
    return undefined;
  }
  return row.error ?? "This build did not finish.";
}

export async function loadProjectThread(projectId: string, userId: string): Promise<ChatMessage[]> {
  const owned = await db
    .select({ id: projects.id, previewUrl: projects.previewUrl })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  if (!owned[0]) {
    return [];
  }
  const liveUrl = owned[0].previewUrl ?? null;
  const restored = await db.select({ id: auditLog.id }).from(auditLog)
    .where(and(eq(auditLog.resourceId, projectId), eq(auditLog.userId, userId), eq(auditLog.action, "project.source_restored"))).limit(1);
  const messages: ChatMessage[] = restored[0] ? [{
    id: restored[0].id, role: "assistant", phase: "done", toolCalls: [],
    content: "Restored the saved source and brief as a separate app. Your original app stays available, and existing contracts keep their on-chain state. Inspect the files, then send a change to build and publish this copy.",
  }] : [];
  const buildRows = await db
    .select({ id: builds.id, prompt: builds.prompt, status: builds.status, error: builds.error, userId: builds.userId, attachments: builds.attachments })
    .from(builds)
    .where(eq(builds.projectId, projectId))
    .orderBy(asc(builds.createdAt));
  const mine = buildRows.filter(function owns(row) {
    return row.userId === userId;
  });
  if (mine.length === 0) {
    return messages;
  }
  const logRows = await db
    .select({ buildId: buildLogs.buildId, chunk: buildLogs.chunk })
    .from(buildLogs)
    .where(inArray(buildLogs.buildId, mine.map(function pick(row) { return row.id; })))
    .orderBy(asc(buildLogs.buildId), asc(buildLogs.seq));
  const byBuild = new Map<string, BuildEvent[]>();
  for (const row of logRows) {
    if (!row.chunk) {
      continue;
    }
    try {
      const event = JSON.parse(row.chunk) as BuildEvent;
      const list = byBuild.get(row.buildId) ?? [];
      list.push(event);
      byBuild.set(row.buildId, list);
    } catch {
      continue;
    }
  }

  mine.forEach(function rebuild(row, index) {
    messages.push({
      id: `${row.id}-u`,
      role: "user",
      content: row.prompt,
      attachments: row.attachments ?? [],
      toolCalls: [],
      phase: "done",
    });
    const events = byBuild.get(row.id) ?? [];
    const toolCalls = recordedBuildSteps(events);
    const doneEvent = events.find(function isDone(event) { return event.phase === "done"; });
    const errorEvent = events.find(function isError(event) { return event.phase === "error"; });
    const stillRunning =
      index === mine.length - 1 && !doneEvent && !errorEvent &&
      RUNNING_BUILD_STATUSES.includes(row.status);
    const errorText = errorTextFor(row, doneEvent, errorEvent, stillRunning);
    // A build still running when the page is reopened stays open in the thread:
    // the console sees the unfinished phase and reattaches to its stream.
    messages.push({
      id: `${row.id}-a`,
      role: "assistant",
      content: doneEvent ? answerFor(doneEvent, index === mine.length - 1 ? liveUrl : null) : "",
      toolCalls,
      phase: stillRunning ? "planning" : "done",
      error: errorText,
      canRetry: errorText !== undefined,
      buildId: row.id,
    });
  });
  return messages;
}

// The agent's own sentence from a done text, in either layout the builder has
// used: agent first with the toolchain line after, or the older toolchain
// first with "The agent's own account:" after.
function agentSummary(text: string): string | null {
  const legacy = text.split("The agent's own account: ")[1];
  if (legacy) {
    return legacy.split("\n")[0].trim() || null;
  }
  const first = text.split("\n")[0].trim();
  if (!first || first.startsWith("Checked by the toolchain:") || first.startsWith("Compiled ") || first.startsWith("No contract:")) {
    return null;
  }
  return first;
}

export interface ProjectOutcome {
  // Notes from the latest finished build's done event; empty when it did
  // everything, or when the latest build failed (its error is on the thread).
  notes: string[];
  // The agent's one-line account from the latest done event, for a card.
  summary: string | null;
}

export async function latestOutcome(projectId: string): Promise<ProjectOutcome> {
  const latest = await db
    .select({ id: builds.id })
    .from(builds)
    .where(and(eq(builds.projectId, projectId), eq(builds.status, "succeeded")))
    .orderBy(desc(builds.createdAt))
    .limit(1);
  if (!latest[0]) {
    return { notes: [], summary: null };
  }
  const rows = await db
    .select({ chunk: buildLogs.chunk })
    .from(buildLogs)
    .where(and(eq(buildLogs.buildId, latest[0].id), eq(buildLogs.level, "done")))
    .limit(1);
  const chunk = rows[0]?.chunk;
  if (!chunk) {
    return { notes: [], summary: null };
  }
  try {
    const event = JSON.parse(chunk) as BuildEvent;
    return { notes: event.notes ?? [], summary: agentSummary(event.text) };
  } catch {
    return { notes: [], summary: null };
  }
}
