import { BUILD_MAINTENANCE_KEY, parseBuildMaintenance } from "../maintenance";
import type { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import type { BuildQueueState } from "@/lib/build/queue-types";
import { describeBuildQueue } from "@/lib/build/queue-status";
import type { BuildEvent } from "@/lib/build/types";
import { STOP_REQUESTED } from "@/lib/build/cancellation";

const encoder = new TextEncoder();
const HEADERS = { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" };

export function workerStream(
  pool: Pool,
  buildId: string,
  signal: AbortSignal,
  cursor: string | null,
  frames: (event: BuildEvent) => Uint8Array[],
  readQueue?: () => Promise<BuildQueueState | null>,
): Response {
  if (cursor !== null && !/^\d{1,10}:\d{1,4}$/.test(cursor)) return Response.json({ error: "Invalid stream cursor." }, { status: 400 });
  let [sequence, frameIndex] = cursor ? cursor.split(":").map(Number) : [-1, -1];
  let lastStatus = "";
  const cancelled = new AbortController();
  const active = AbortSignal.any([signal, cancelled.signal]);
  // Poll only when the HTTP consumer asks for data. A slow tab must not make
  // the web process read and buffer the entire durable event history.
  async function* messages(): AsyncGenerator<Uint8Array> {
    try {
      while (!active.aborted) {
        const rows = await pool.query<{ seq: number; chunk: string | null }>(
          "select seq,chunk from build_logs where build_id=$1 and seq >= $2 order by seq limit 16", [buildId, sequence],
        );
        let sent = false;
        for (const row of rows.rows) {
          if (active.aborted) return;
          if (!row.chunk) continue;
          const event = JSON.parse(row.chunk) as BuildEvent;
          const chunks = frames(event);
          for (let index = 0; index < chunks.length; index += 1) {
            if (row.seq < sequence || row.seq === sequence && index <= frameIndex) continue;
            const header = encoder.encode(`id: ${row.seq}:${index}\n`);
            const frame = new Uint8Array(header.byteLength + chunks[index].byteLength);
            frame.set(header);
            frame.set(chunks[index], header.byteLength);
            yield frame;
            sequence = row.seq; frameIndex = index; sent = true;
          }
        }
        const result = await pool.query<{ state: string; status: string; error: string | null; last_seq: number | null; has_terminal: boolean; maintenance_setting: string | null }>(`
          select j.state,b.status,b.error,(select max(seq) from build_logs where build_id=b.id) as last_seq,
            exists(select 1 from build_logs where build_id=b.id and level in ('done','error')) as has_terminal,
            (select value from app_settings where key=$2) as maintenance_setting
          from build_worker_jobs j join builds b on b.id=j.build_id where j.build_id=$1
        `, [buildId, BUILD_MAINTENANCE_KEY]);
        const current = result.rows[0];
        if (!current) break;
        if (["succeeded", "failed", "killed"].includes(current.status) && sequence >= (current.last_seq ?? -1)) {
          if (!current.has_terminal) {
            const terminal: BuildEvent = current.status === "succeeded"
              ? { phase: "done", text: "Build complete." }
              : { phase: "error", text: current.error ?? "This build did not finish." };
            for (const chunk of frames(terminal)) yield chunk;
          }
          break;
        }
        const maintenance = parseBuildMaintenance(current.maintenance_setting);
        let status = "";
        let buildState: string | undefined;
        let queue: BuildQueueState | null = null;
        if (current.error === STOP_REQUESTED) {
          status = "Stop requested. Finishing cleanup and recording any transaction already sent.";
          buildState = "stopping";
        } else if (current.state === "paused_budget") {
          status = "Your progress is saved. Review the next allowance to continue, or stop the build.";
          buildState = "paused_budget";
        } else if (current.state === "recovery_required") {
          status = "Your source files are saved. This build is paused while we check an interruption.";
          buildState = "paused";
        } else if (current.state === "queued") {
          queue = await readQueue?.() ?? null;
          if (queue) queue = { ...queue, maintenance: maintenance ?? undefined };
          status = queue ? describeBuildQueue(queue).description : "Confirming your queue status.";
        } else if (current.state === "running") {
          status = "Your build has started. Waiting for the next recorded update.";
          buildState = "running";
        }
        const snapshot = JSON.stringify({ step: status, buildState, queue, maintenance });
        if (status && snapshot !== lastStatus) {
          yield encoder.encode(`event: status\ndata: ${snapshot}\n\n`);
          lastStatus = snapshot;
        }
        if (!sent) yield encoder.encode(":ka\n\n");
        if (rows.rows.length < 16) await delay(1000, undefined, { signal: active });
      }

    } catch (cause) {
      if (!active.aborted) throw cause;
    }
  }
  const iterator = messages();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const next = await iterator.next();
        if (cancelled.signal.aborted) return;
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (cause) {
        if (!cancelled.signal.aborted) controller.error(cause);
      }
    },
    async cancel(): Promise<void> {
      cancelled.abort();
      await iterator.return(undefined);
    },
  }, { highWaterMark: 0 });
  return new Response(stream, { headers: HEADERS });
}
