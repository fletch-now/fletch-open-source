import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { workerStream } from "./stream";
import type { BuildEvent } from "@/lib/build/types";

function frames(event: BuildEvent): Uint8Array[] {
  const encoder = new TextEncoder();
  const frame = encoder.encode(`event: ${event.phase}\ndata: ${JSON.stringify({ text: event.text })}\n\n`);
  return event.phase === "compiling" ? [frame, encoder.encode('event: report\ndata: {"ok":true}\n\n')] : [frame];
}

test("persisted worker SSE reports queued cancellation and resumes between frames without duplication", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function streams(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const namespace = `worker_stream_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, options: `-c search_path=${namespace},public` });
  t.after(async function cleanup() { await pool.end(); await admin.query(`drop schema ${namespace} cascade`); await admin.end(); });
  await pool.query("create table builds(id text primary key,status text,error text)");
  await pool.query("create table build_worker_jobs(build_id text primary key,state text)");
  await pool.query("create table app_settings(key text primary key,value text)");
  await pool.query("create table build_logs(build_id text,seq integer,level text,chunk text)");
  await pool.query("insert into builds values('cancelled','failed','Cancelled while queued.'),('done','succeeded',null)");
  await pool.query("insert into build_worker_jobs values('cancelled','stopped'),('done','completed')");
  const cancel = workerStream(pool, "cancelled", new AbortController().signal, null, frames);
  assert.match(await cancel.text(), /event: error\ndata: .*Cancelled while queued/);
  const events: BuildEvent[] = [{ phase: "note", text: "Started" }, { phase: "compiling", text: "Compiled" }, { phase: "done", text: "Complete" }];
  for (const [seq, event] of events.entries()) await pool.query("insert into build_logs values('done',$1,$2,$3)", [seq, event.phase, JSON.stringify(event)]);
  const full = await workerStream(pool, "done", new AbortController().signal, null, frames).text();
  assert.deepEqual([...full.matchAll(/id: ([\d:]+)/g)].map(function id(match) { return match[1]; }), ["0:0", "1:0", "1:1", "2:0"]);
  const resumed = await workerStream(pool, "done", new AbortController().signal, "1:0", frames).text();
  assert.deepEqual([...resumed.matchAll(/id: ([\d:]+)/g)].map(function id(match) { return match[1]; }), ["1:1", "2:0"]);
  assert.doesNotMatch(resumed, /Compiled|Started/);
  assert.equal(await workerStream(pool, "done", new AbortController().signal, "2:0", frames).text(), "");
  assert.equal(workerStream(pool, "done", new AbortController().signal, "invalid", frames).status, 400);
  await pool.query("insert into builds values('waiting','queued',null),('paused','building',null)");
  await pool.query("insert into build_worker_jobs values('waiting','queued'),('paused','recovery_required')");
  const queue = { position: 3, ahead: 2, running: 2, reserved: 0, capacity: 2 };
  const queued = workerStream(pool, "waiting", new AbortController().signal, null, frames, async () => queue).body!.getReader();
  const queueFrame = new TextDecoder().decode((await queued.read()).value);
  assert.match(queueFrame, /2 builds are ahead of yours/);
  assert.match(queueFrame, /"queue":\{"position":3,"ahead":2,"running":2,"reserved":0,"capacity":2\}/);
  await queued.cancel();
  // The worker can claim the job before writing its first log. That database
  // transition must clear the queue display without waiting for a tool event.
  const available = { position: 1, ahead: 0, running: 0, reserved: 0, capacity: 2 };
  const starting = workerStream(pool, "waiting", new AbortController().signal, null, frames, async () => available).body!.getReader();
  assert.match(new TextDecoder().decode((await starting.read()).value), /Waiting for the worker to pick it up/);
  await pool.query("update build_worker_jobs set state='running' where build_id='waiting'");
  await pool.query("update builds set status='building' where id='waiting'");
  let started = "";
  while (!started.includes('"buildState":"running"')) started += new TextDecoder().decode((await starting.read()).value);
  assert.match(started, /"queue":null/);
  assert.match(started, /Your build has started/);
  assert.doesNotMatch(started, /event: (?:note|phase|tool_use)/);
  await starting.cancel();
  const maintenance = { version: 1, operationId: "private-operation", phase: "draining", startedAt: "2020-01-01T00:00:00Z", heartbeatAt: "2020-01-01T00:00:00Z", expiresAt: "2020-01-01T00:01:00Z" };
  await pool.query("insert into app_settings values('build.maintenance',$1)", [JSON.stringify(maintenance)]);
  await pool.query("update build_worker_jobs set state='queued' where build_id='waiting'");
  await pool.query("update builds set status='queued' where id='waiting'");
  const held = workerStream(pool, "waiting", new AbortController().signal, "0:0", frames, async () => available).body!.getReader();
  const heldFrame = new TextDecoder().decode((await held.read()).value);
  assert.match(heldFrame, /Builder is being updated/);
  assert.match(heldFrame, /"stale":true/);
  assert.doesNotMatch(heldFrame, /private-operation|Your build has started/);
  await pool.query("delete from app_settings where key='build.maintenance'");
  let cleared = "";
  while (!cleared.includes('"maintenance":null')) cleared += new TextDecoder().decode((await held.read()).value);
  assert.match(cleared, /Waiting for the worker to pick it up/);
  await held.cancel();
  const paused = workerStream(pool, "paused", new AbortController().signal, null, frames).body!.getReader();
  assert.match(new TextDecoder().decode((await paused.read()).value), /"buildState":"paused"/);
  // Import the authoritative marker instead of relying on user-facing copy.
  const { STOP_REQUESTED } = await import("@/lib/build/cancellation");
  await pool.query("update builds set error=$1 where id='paused'", [STOP_REQUESTED]);
  let stopping = "";
  while (!stopping.includes('"buildState":"stopping"')) stopping += new TextDecoder().decode((await paused.read()).value);
  await paused.cancel();

});

test("a stalled progress reader stops fetching history and cancellation stops polling", async function backpressure(): Promise<void> {
  let reads = 0;
  const pool = {
    async query(): Promise<{ rows: { seq: number; chunk: string }[] }> {
      reads++;
      return { rows: Array.from({ length: 16 }, (_, seq) => ({ seq, chunk: JSON.stringify({ phase: "note", text: "x".repeat(8192) }) })) };
    },
  } as unknown as Pool;
  const response = workerStream(pool, "controlled", new AbortController().signal, null, frames);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reads, 0, "No consumer means no database polling");
  const reader = response.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /id: 0:0/);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(reads, 1, "A stalled reader retains one bounded batch");
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reads, 1, "Cancelled streams release their producer");
});
