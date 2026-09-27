import "@/lib/test-server-only";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildReply } from "@/components/chat/build-reply";
import * as schema from "@/lib/db/schema";
import { buildCapacity, cancelQueuedBuild, claimNextBuild, failClaimedBuild, finishBuildSuccessfully, requestBuildStop, readBuildQueue, recoverInterruptedBuilds } from "@/lib/build/queue";

import { STOP_REQUESTED } from "./cancellation";
import { reapStaleBuilds } from "@/lib/build/reaper";

const { builds, creditEvents } = schema;

test("sandbox capacity rejects nonfinite, fractional, zero and unsafe overrides", function capacity() {
  assert.equal(buildCapacity("1"), 1);
  assert.equal(buildCapacity("2"), 2);
  assert.equal(buildCapacity("50"), 50);
  assert.equal(buildCapacity("100"), 100);
  for (const value of ["", "0", "101", "NaN", "Infinity", "1.5", "-1"]) {
    assert.throws(() => buildCapacity(value), /integer from 1 to 100/);
  }
});

test("database queue enforces FIFO, capacity, restart retention and atomic owned cancellation", {
  skip: !process.env.FLETCH_TEST_DATABASE_URL,
}, async function queue(t) {
  const connectionString = process.env.FLETCH_TEST_DATABASE_URL;
  const admin = new Pool({ connectionString });
  const namespace = `queue_test_${randomUUID().replaceAll("-", "")}`;
  await admin.query(`create schema ${namespace}`);
  const pool = new Pool({ connectionString, max: 20, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  // Copy the deployed column/default/unique-key definitions, without sharing any
  // real queued rows or rewriting statuses owned by other parallel test suites.
  await pool.query(`create table ${namespace}.builds (like public.builds including all)`);
  await pool.query("alter table builds add column if not exists pricing_quote_id text, add column if not exists pricing_snapshot jsonb");
  // Keep the legacy fixture independent of when the shared baseline is migrated.
  const states = schema.buildStatus.enumValues.map(value => `'${value}'`).join(",");
  await pool.query(`create type ${namespace}.build_status as enum (${states})`);
  await pool.query("alter table builds alter column status drop default");
  await pool.query(`alter table builds alter column status type ${namespace}.build_status using status::text::${namespace}.build_status`);
  await pool.query("alter table builds alter column status set default 'queued'");
  await pool.query(`create table ${namespace}.credit_events (like public.credit_events including all)`);
  await pool.query(`create table ${namespace}.build_worker_jobs (like public.build_worker_jobs including all)`);
  await pool.query("create table app_settings(key text primary key,value text)");
  const owner = "queue-test-owner";
  async function reset(): Promise<void> { await pool.query("truncate builds,credit_events,build_worker_jobs"); }
  async function insert(id: string, own = false): Promise<void> {
    await database.insert(builds).values({ id, userId: owner, prompt: "Use the complete attached brief", projectId: "saved-project",
      createdAt: new Date("2020-01-01"), billingMode: own ? "own_key" : "platform",
      custodyMode: own ? "hosted" : "platform", provider: "kimi", model: "kimi-k3",
      credentialId: own ? "safe-credential-id" : null, credentialVersion: own ? 7 : null,
      attachments: [{ name: "brief.txt", content: "Full contract and wallet brief" }],
    });
    if (!own) await database.insert(creditEvents).values({ id: randomUUID(), userId: owner, buildId: id,
      reason: "build_debit", delta: -1, idempotencyKey: `build_debit:${id}` });
  }
  try {
    await t.test("maintenance preserves legacy running work, queued drafts and cancellation until explicit clear", async function maintenance() {
      await reset();
      await insert("maintenance-running");
      assert.ok(await claimNextBuild(database));
      await pool.query("update builds set project_id='other-project' where id='maintenance-running'");
      await pool.query("insert into app_settings values('build.maintenance','malformed')");
      await insert("maintenance-queued");
      assert.equal(await claimNextBuild(database), null);
      const snapshot = await readBuildQueue("maintenance-queued", database);
      assert.equal(snapshot?.maintenance?.stale, true);
      assert.equal(snapshot?.running, 1);
      assert.equal((await pool.query("select status from builds where id='maintenance-running'")).rows[0].status, "building");
      const cancelled = await cancelQueuedBuild("maintenance-queued", owner, database);
      assert.equal(cancelled?.draft?.prompt, "Use the complete attached brief");
      assert.equal(cancelled?.draft?.attachments.length, 1);
      assert.equal(cancelled?.refunded, true);
      await insert("maintenance-after-clear");
      assert.equal(await claimNextBuild(database), null);
      await pool.query("delete from app_settings where key='build.maintenance'");
      assert.equal((await claimNextBuild(database))?.id, "maintenance-after-clear");
      assert.equal((await readBuildQueue("maintenance-after-clear", database)), null);
    });
    await t.test("paused recovery is visible separately from execution and still reserves capacity", async function pausedCapacity() {
      await reset();
      await insert("queued-after-pause");
      await insert("paused");
      await insert("executing");
      await pool.query("update builds set status='building',project_id=id where id in ('paused','executing')");
      await pool.query(`insert into build_worker_jobs(build_id,workspace_key,state,owner_id,fence,lease_expires_at)
        values('paused','project:paused','recovery_required','prior-owner','prior-fence',now()+interval '5 minutes')`);
      await database.update(builds).set({ status: "succeeded" }).where(eq(builds.id, "executing"));
      const paused = await readBuildQueue("queued-after-pause", database);
      assert.deepEqual(paused, { ahead: 0, position: 1, running: 0, reserved: 1, capacity: 2 });
      const html = renderToStaticMarkup(createElement(BuildReply, { content: "", active: true, queue: paused }));
      assert.match(html, /0 of 2 building/);
      assert.match(html, /1 slot held for recovery/);
      assert.doesNotMatch(html, /1 of 2 build slots running/);

      await database.update(builds).set({ status: "building" }).where(eq(builds.id, "executing"));
      await pool.query(`insert into build_worker_jobs(build_id,workspace_key,state,owner_id,fence,lease_expires_at)
        values('executing','project:executing','running','live-owner','live-fence',now()+interval '5 minutes')`);
      assert.deepEqual(await readBuildQueue("queued-after-pause", database), { ahead: 0, position: 1, running: 1, reserved: 1, capacity: 2 });
      assert.equal(await claimNextBuild(database), null);

      await pool.query("update build_worker_jobs set lease_expires_at=now()-interval '1 second' where build_id='executing'");
      assert.deepEqual(await readBuildQueue("queued-after-pause", database), { ahead: 0, position: 1, running: 0, reserved: 2, capacity: 2 });
      assert.equal(await claimNextBuild(database), null);
      await pool.query("update builds set status='paused' where id='paused'");
      await pool.query("update build_worker_jobs set state='paused_budget' where build_id='paused'");
      assert.deepEqual(await readBuildQueue("queued-after-pause", database), { ahead: 0, position: 1, running: 0, reserved: 2, capacity: 2 });
      assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 0);
    });
    await t.test("Stop intent is owned, durable, holds capacity and fences success until atomic refund", async function stopIntent() {
      await reset();
      await insert("stop-active");
      await claimNextBuild(database);
      assert.equal(await requestBuildStop("stop-active", "other-owner", database), false);
      const requests = await Promise.all(Array.from({ length: 20 }, () => requestBuildStop("stop-active", owner, database)));
      assert.ok(requests.every(Boolean));
      const [pending] = await database.select().from(builds).where(eq(builds.id, "stop-active"));
      assert.equal(pending.status, "building");
      assert.equal(pending.error, STOP_REQUESTED);
      assert.equal(pending.finishedAt, null);
      await database.update(builds).set({ startedAt: new Date("2020-01-01") }).where(eq(builds.id, "stop-active"));
      assert.equal(await reapStaleBuilds(150, database), 0);
      assert.equal(await failClaimedBuild("stop-active", owner, "Timed out", database, { preserveStopRequested: true }), false);
      assert.equal(await finishBuildSuccessfully("stop-active", database), false);
      assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 0);
      await Promise.all(Array.from({ length: 20 }, () => failClaimedBuild("stop-active", owner, "late process failure", database)));
      const [stopped] = await database.select().from(builds).where(eq(builds.id, "stop-active"));
      assert.equal(stopped.status, "failed");
      assert.equal(stopped.error, STOP_REQUESTED);
      assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 1);
    });
    await t.test("Stop racing success has one winner and never refunds a successful build", async function stopRace() {
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await reset();
        await insert("stop-race");
        await claimNextBuild(database);
        const [stopped, succeeded] = await Promise.all([
          requestBuildStop("stop-race", owner, database), finishBuildSuccessfully("stop-race", database),
        ]);
        assert.notEqual(stopped, succeeded);
        await failClaimedBuild("stop-race", owner, "late error", database);
        const [row] = await database.select().from(builds).where(eq(builds.id, "stop-race"));
        assert.equal(row.status, stopped ? "failed" : "succeeded");
        assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, stopped ? 1 : 0);
      }
    });
    await t.test("general Stop racing a queue claim always cancels the queue or requests active cleanup", async function generalStopRace() {
      const { cancelBuild } = await import("./runner");
      for (let attempt = 0; attempt < 25; attempt += 1) {
        await reset();
        await insert("general-stop-race");
        const [claimed, outcome] = await Promise.all([
          claimNextBuild(database), cancelBuild("general-stop-race", owner, database),
        ]);
        assert.ok(outcome);
        assert.equal(outcome.stopping, Boolean(claimed));
        if (claimed) await failClaimedBuild("general-stop-race", owner, STOP_REQUESTED, database);
        const [row] = await database.select().from(builds).where(eq(builds.id, "general-stop-race"));
        assert.equal(row.status, "failed");
        assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 1);
      }
    });
    await t.test("restart recovery preserves Stop intent and never grants own-key credits", async function stoppedRestart() {
      await reset();
      await insert("stopped-own", true);
      await claimNextBuild(database);
      assert.equal(await requestBuildStop("stopped-own", owner, database), true);
      await recoverInterruptedBuilds(database);
      const [row] = await database.select().from(builds).where(eq(builds.id, "stopped-own"));
      assert.equal(row.status, "failed");
      assert.equal(row.error, STOP_REQUESTED);
      assert.equal((await database.select().from(creditEvents)).length, 0);
    });
    await t.test("100 simultaneous claims start only two, then all rows drain in stable FIFO without a browser", async function fifo() {
      await database.insert(builds).values(Array.from({ length: 100 }, (_, index) => ({
        id: `queued-${String(index).padStart(3, "0")}`, userId: `owner-${index}`, prompt: "A simulated build",
        createdAt: new Date("2020-01-01"),
      })).reverse());
      const results = await Promise.all(Array.from({ length: 100 }, () => claimNextBuild(database)));
      const started = results.filter((row) => row !== null);
      assert.deepEqual(started.map((row) => row.id).sort(), ["queued-000", "queued-001"]);
      assert.deepEqual(await readBuildQueue("queued-099", database), { ahead: 97, position: 98, running: 2, reserved: 0, capacity: 2 });
      assert.equal(await readBuildQueue("queued-000", database), null);
      const observed: string[] = [];
      for (let index = 0; index < 50; index += 1) {
        await database.update(builds).set({ status: "succeeded" }).where(eq(builds.status, "building"));
        const wave = await Promise.all(Array.from({ length: 8 }, () => claimNextBuild(database)));
        const claimed = wave.filter((row) => row !== null).map((row) => row.id).sort();
        assert.ok(claimed.length <= 2);
        observed.push(...claimed);
      }
      assert.deepEqual(observed, Array.from({ length: 98 }, (_, index) => `queued-${String(index + 2).padStart(3, "0")}`));
    });
    await t.test("restart recovery preserves arbitrarily old queued briefs and refunds interrupted execution once", async function restart() {
      await reset(); await insert("old-queued");
      assert.equal(await reapStaleBuilds(1, database), 0);
      await insert("interrupted");
      await database.update(builds).set({ status: "building", startedAt: new Date("2020-01-01") }).where(eq(builds.id, "interrupted"));
      assert.deepEqual(await recoverInterruptedBuilds(database), ["interrupted"]);
      assert.deepEqual(await recoverInterruptedBuilds(database), []);
      const [waiting] = await database.select().from(builds).where(eq(builds.id, "old-queued"));
      assert.equal(waiting.status, "queued"); assert.equal(waiting.attachments?.length, 1);
      assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 1);
      assert.equal((await claimNextBuild(database))?.id, "old-queued");
    });
    await t.test("ownership and concurrent queued cancellation preserve exact draft and refund only once", async function cancel() {
      await reset(); await insert("edit");
      assert.equal(await cancelQueuedBuild("edit", "other-owner", database), null);
      const results = await Promise.all(Array.from({ length: 20 }, () => cancelQueuedBuild("edit", owner, database)));
      const drafts = results.filter((draft) => draft !== null);
      assert.equal(drafts.length, 1);
      assert.equal(drafts[0].refunded, true);
      assert.equal(drafts[0].draft?.projectId, "saved-project");
      assert.deepEqual(drafts[0].draft?.attachments, [{ name: "brief.txt", content: "Full contract and wallet brief" }]);
      assert.deepEqual(drafts[0].draft?.selection, { billingMode: "platform" });
      const credits = await database.select().from(creditEvents);
      assert.equal(credits.length, 2); assert.equal(credits.reduce((sum, row) => sum + row.delta, 0), 0);
    });
    await t.test("own-key draft retains the immutable binding without minting credits or exposing keys", async function own() {
      await reset(); await insert("own", true);
      const draft = await cancelQueuedBuild("own", owner, database);
      assert.deepEqual(draft?.draft?.selection, { billingMode: "own_key", custodyMode: "hosted", provider: "kimi", model: "kimi-k3", credentialId: "safe-credential-id", credentialVersion: 7 });
      assert.equal((await database.select().from(creditEvents)).length, 0);
    });
    await t.test("legacy broken own-key bindings remain cancellable without restoring a platform draft", async function legacy() {
      await reset();
      await database.insert(builds).values({ id: "legacy-own", userId: owner, prompt: "Legacy brief", billingMode: "own_key" });
      assert.deepEqual(await cancelQueuedBuild("legacy-own", owner, database), { draft: null, refunded: false });
      assert.equal((await database.select().from(builds))[0].status, "failed");
      assert.equal((await database.select().from(creditEvents)).length, 0);
    });
    await t.test("claim/cancel race either cancels before spend or refuses to stop the claimed build", async function race() {
      for (let index = 0; index < 25; index += 1) {
        await reset(); await insert("race");
        const [claimed, cancelled] = await Promise.all([claimNextBuild(database), cancelQueuedBuild("race", owner, database)]);
        assert.notEqual(Boolean(claimed), Boolean(cancelled));
        const [row] = await database.select().from(builds);
        assert.equal(row.status, claimed ? "building" : "failed");
        assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, cancelled ? 1 : 0);
      }
    });
    await t.test("failed claims roll back and setup failures release database capacity with one owned refund", async function failures() {
      await reset(); await insert("failed-setup"); await insert("next");
      await database.execute(sql`alter table builds add constraint fixture_claim_failure check (status <> 'building')`);
      await assert.rejects(claimNextBuild(database));
      assert.equal((await readBuildQueue("failed-setup", database))?.position, 1);
      await database.execute(sql`alter table builds drop constraint fixture_claim_failure`);
      const first = await claimNextBuild(database);
      assert.equal(first?.id, "failed-setup");
      await failClaimedBuild(first!.id, owner, "Project lookup failed", database);
      await failClaimedBuild(first!.id, owner, "Project lookup failed", database);
      assert.equal((await readBuildQueue("next", database))?.running, 0);
      assert.equal((await claimNextBuild(database))?.id, "next");
      assert.equal((await database.select().from(creditEvents).where(eq(creditEvents.reason, "refund"))).length, 1);
    });
    await t.test("refund failure rolls the cancellation back so the pending debit cannot be stranded", async function rollback() {
      await reset(); await insert("rollback");
      await database.execute(sql`alter table credit_events add constraint fixture_refund_failure check (reason <> 'refund')`);
      await assert.rejects(cancelQueuedBuild("rollback", owner, database));
      const [row] = await database.select().from(builds);
      assert.equal(row.status, "queued");
      await database.execute(sql`alter table credit_events drop constraint fixture_refund_failure`);
      assert.ok(await cancelQueuedBuild("rollback", owner, database));
    });
  } finally {
    await pool.end();
    await admin.query(`drop schema ${namespace} cascade`);
    await admin.end();
  }
});
