import { STOP_REQUESTED } from "@/lib/build/cancellation";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { asc, eq } from "drizzle-orm";
import { RUNNING_BUILD_STATUSES } from "@/lib/build/status";
import { getSession } from "@/lib/dal";
import { db, pool } from "@/lib/db";
import { workerStream } from "@/lib/build/durable/stream";
import { buildLogs, builds } from "@/lib/db/schema";
import { attach, ensureBuildRunning } from "@/lib/build/runner";
import { readBuildQueue } from "@/lib/build/queue";
import { waitForQueuePoll } from "@/lib/build/queue-wait";
import type { Attachment } from "@/lib/build/runner";
import type { BuildEvent } from "@/lib/build/types";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Streaming breaks behind a buffering reverse proxy without this.
  "X-Accel-Buffering": "no",
};

const encoder = new TextEncoder();

function frame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function finalAnswer(event: BuildEvent): string {
  const lines = [event.text.trim() || "Build complete."];
  if (event.previewUrl) {
    lines.push(`\n**Live app**: ${event.previewUrl}`);
  }
  if (event.explorerUrl) {
    const verdict = event.verified ? "source verified on the chain explorer" : "on the explorer";
    lines.push(`**Testnet contract**: ${verdict}: ${event.explorerUrl}`);
  }
  // The done event's own text already says why a deploy or publish did not
  // happen; nothing is added here that the toolchain did not report.
  return lines.join("\n");
}

// Metadata travels independently so it survives every event phase and replay.
function framesFor(event: BuildEvent): Uint8Array[] {
  const frames = eventFrames(event);
  if (event.templateVersion !== undefined) {
    frames.unshift(frame("template", { version: event.templateVersion }));
  }
  return frames;
}

// One build event becomes one or more SSE frames in the agentic-chat contract.
function eventFrames(event: BuildEvent): Uint8Array[] {
  if (event.stopping) return [frame("status", { step: event.text, buildState: "stopping" })];
  if (event.phase === "done") {
    return [
      frame("phase", "answering"),
      frame("text_bulk", { content: finalAnswer(event) }),
      // The panel reads these fields, never the prose: a note that mentions a
      // URL must not become a button.
      frame("done", {
        previewUrl: event.previewUrl ?? null,
        draftReady: event.draftReady ?? false,
        explorerUrl: event.explorerUrl ?? null,
        contractAddress: event.contractAddress ?? null,
        contractName: event.contractName ?? null,
        verified: event.verified ?? null,
        notes: event.notes ?? [],
      }),
    ];
  }
  if (event.phase === "error") {
    return [frame("error", { message: event.text, canRetry: true })];
  }
  // The agent's own words, sent as they arrive. A build used to be a silent
  // list of file writes with minutes between them; this is what the agent says
  // it is doing, in the thread, while it does it.
  if (event.phase === "note") {
    return [frame("note", { content: event.text, at: event.at ?? null })];
  }
  if (event.artifact) {
    return [frame("artifact", event.artifact)];
  }
  if (event.toolOutput !== undefined) {
    return [frame("tool_result", {
      tool: event.phase,
      id: event.toolCallId,
      summary: event.text,
      output: event.toolOutput,
      outputTruncated: event.toolOutputTruncated,
      outputChars: event.toolOutputChars,
    })];
  }
  if (event.needs) {
    return [
      frame("status", { step: event.text }),
      frame("tool_use", { tool: event.phase, input: event.text, round: 1, at: event.at ?? null }),
      frame("tool_result", { tool: event.phase, summary: "done" }),
      frame("needs", { ...event.needs, overridden: event.needsOverridden === true }),
    ];
  }
  // The toolchain's own verdict travels as its own frame so the build surface can
  // render solc and forge output rather than a sentence about them.
  if (event.compile) {
    return [
      frame("status", { step: event.text }),
      frame("tool_use", { tool: "compiling", input: event.text, round: 1, at: event.at ?? null }),
      frame("tool_result", { tool: "compiling", summary: event.compile.ok ? "compiled" : "failed" }),
      frame("compile", event.compile),
    ];
  }
  if (event.analysis) {
    return [frame("analysis", event.analysis), frame("status", { step: event.text })];
  }
  if (event.tests) {
    return [
      frame("status", { step: event.text }),
      frame("tool_use", { tool: "testing", input: event.text, round: 1, at: event.at ?? null }),
      frame("tool_result", { tool: "testing", summary: `${event.tests.passed}/${event.tests.total}` }),
      frame("tests", event.tests),
    ];
  }
  if (event.toolCallId) {
    return [
      frame("status", { step: event.text }),
      frame("tool_use", { tool: event.phase, input: event.text, id: event.toolCallId, at: event.at ?? null }),
    ];
  }
  return [
    frame("status", { step: event.text }),
    frame("tool_use", { tool: event.phase, input: event.text, round: 1, at: event.at ?? null }),
    frame("tool_result", { tool: event.phase, summary: "done" }),
  ];
}


function isTerminal(event: BuildEvent): boolean {
  return event.phase === "done" || event.phase === "error";
}

// Everything persisted for a build that is no longer in memory (finished
// earlier, or the server restarted), as one burst.
async function replayFromLog(buildId: string): Promise<Response> {
  const logged = await db
    .select({ chunk: buildLogs.chunk })
    .from(buildLogs)
    .where(eq(buildLogs.buildId, buildId))
    .orderBy(asc(buildLogs.seq));
  const [current] = await db.select({ status: builds.status, error: builds.error }).from(builds).where(eq(builds.id, buildId)).limit(1);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let terminal = false;
      for (const row of logged) {
        if (!row.chunk) {
          continue;
        }
        const event = JSON.parse(row.chunk) as BuildEvent;
        if (isTerminal(event)) {
          terminal = true;
        }
        for (const chunk of framesFor(event)) {
          controller.enqueue(chunk);
        }
      }
      if (!terminal && current && !RUNNING_BUILD_STATUSES.includes(current.status)) {
        if (current.status === "succeeded") controller.enqueue(frame("done", {}));
        else controller.enqueue(frame("error", { message: current.error ?? "This build did not finish.", canRetry: true }));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

// Forwards a run that is in memory: everything so far, then live until the
// terminal event. A disconnect drops this subscriber only.
function forwardLive(controller: ReadableStreamDefaultController<Uint8Array>, live: Attachment, signal: AbortSignal): void {
  let open = true;

  function push(event: BuildEvent): void {
    if (!open) {
      return;
    }
    try {
      for (const chunk of framesFor(event)) {
        controller.enqueue(chunk);
      }
    } catch {
      open = false;
    }
  }

  // The client aborts after minutes of silence, and a build legitimately goes
  // quiet for longer while the agent waits on the model. The client ignores
  // ':' comment frames.
  const keepalive = setInterval(function beat() {
    if (!open) {
      return;
    }
    try {
      controller.enqueue(encoder.encode(":ka\n\n"));
    } catch {
      open = false;
    }
  }, 15_000);

  function finish(): void {
    open = false;
    clearInterval(keepalive);
    try {
      controller.close();
    } catch {
      // already closed
    }
  }

  for (const event of live.replay) {
    push(event);
  }

  if (live.finished) {
    finish();
    return;
  }

  const unsubscribe = live.subscribe(function onEvent(event) {
    push(event);
    if (isTerminal(event)) {
      unsubscribe();
      finish();
    }
  });

  signal.addEventListener("abort", function onAbort() {
    open = false;
    clearInterval(keepalive);
    unsubscribe();
  });
}

const QUEUE_POLL_MS = 3_000;

// A build created while every slot was taken waits as a 'queued' row. The
// stream stays open and reports the place in line until a slot frees and the
// run comes into memory, then follows it like any other.
async function waitInQueue(
  controller: ReadableStreamDefaultController<Uint8Array>,
  buildId: string,
  signal: AbortSignal,
): Promise<Attachment | null> {
  let lastQueue = "";
  while (!signal.aborted) {
    await ensureBuildRunning(buildId);
    const live = attach(buildId);
    if (live) {
      return live;
    }
    const current = await db.select({ status: builds.status }).from(builds).where(eq(builds.id, buildId)).limit(1);
    if (!current[0] || !RUNNING_BUILD_STATUSES.includes(current[0].status)) {
      return null;
    }
    const queue = await readBuildQueue(buildId);
    const snapshot = JSON.stringify(queue);
    if (queue && snapshot !== lastQueue) {
      lastQueue = snapshot;
      const ahead = queue.ahead;
      const text = ahead === 0 ? "Queued, starting as soon as a build slot frees" : `Queued behind ${ahead} ${ahead === 1 ? "build" : "builds"}, starting when a slot frees`;
      controller.enqueue(frame("status", { step: text, queue }));
    } else {
      controller.enqueue(encoder.encode(":ka\n\n"));
    }
    await waitForQueuePoll(QUEUE_POLL_MS, signal);
  }
  return null;
}

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/builds/[id]/stream">,
): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Sign in", requiresLogin: true }, { status: 401 });
  }
  const { id } = await ctx.params;
  const rows = await db.select().from(builds).where(eq(builds.id, id)).limit(1);
  const build = rows[0];
  if (!build || build.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const owned = await pool.query("select 1 from build_worker_jobs where build_id=$1", [build.id]);
  if (owned.rows[0]) return workerStream(pool, build.id, request.signal, request.headers.get("Last-Event-ID"), framesFor, () => readBuildQueue(build.id));

  // Start it if it has not started; either way we only subscribe below, so the run
  // is never tied to this request's lifetime.
  await ensureBuildRunning(build.id);
  const live = attach(build.id);

  if (!live && build.status !== "queued") {
    return replayFromLog(build.id);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const run = live ?? (await waitInQueue(controller, build.id, request.signal));
      if (!run) {
        if (request.signal.aborted) {
          return;
        }
        // Left the queue without ever running: the reaper or a cancel failed it.
        const current = await db.select({ error: builds.error }).from(builds).where(eq(builds.id, build.id)).limit(1);
        controller.enqueue(frame("error", { message: current[0]?.error ?? "The build did not start.", canRetry: true }));
        controller.close();
        return;
      }
      if (build.error === STOP_REQUESTED) controller.enqueue(frame("status", { step: "Stop requested. Finishing cleanup and recording any transaction already sent.", buildState: "stopping" }));
      controller.enqueue(frame("phase", "planning"));
      forwardLive(controller, run, request.signal);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
