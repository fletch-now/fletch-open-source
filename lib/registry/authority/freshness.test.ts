// Run with: node --import tsx --test lib/registry/authority/freshness.test.ts
//
// The verdict rules are pure and tested here; the reads need a database.
// The first test is the acceptance check from docs/PLAN-AUTHORITY-2.md item
// A: the status endpoint names every job the daemon schedules. The daemon
// builds its table with `job("<name>", …)` from JOB_CADENCES, so the source
// is compared with the map rather than with a running process.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { JOB_CADENCES, JOB_CHECKPOINTS, JOB_NAMES } from "@/lib/registry/authority/cadence";
import { DAEMON_STALE_MS, jobVerdict, LATE_FLOOR_MS, overallVerdict, rateFromSamples, STALL_FLOOR_MS, summarize, type JobFreshness, type JobVerdict } from "@/lib/registry/authority/freshness";
import { metricCoverageFromDetail } from "./metric-coverage";

test("every job the daemon schedules has a cadence, and every cadence is scheduled", function () {
  const source = readFileSync(new URL("../../../workers/registry.ts", import.meta.url), "utf8");
  // Digits belong in a job name: the venues are dex-pools (v4) and dex-pools-v3.
  const scheduled = [...source.matchAll(/\bjob\("([a-z0-9-]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(scheduled, [...JOB_NAMES].sort());
  assert.ok(scheduled.length >= 24);
});

test("every checkpoint belongs to a scheduled job", function () {
  for (const job of Object.keys(JOB_CHECKPOINTS)) {
    assert.ok(job in JOB_CADENCES, job);
  }
});

const MINUTE = 60_000;

test("a successful loop cannot hide failed or incomplete required metric reads", function () {
  const metric = { eligible: 10, current: 8, failed: 1, unread: 1, oldestInputAgeSeconds: 80, measuredAt: "2026-09-10T12:00:00Z" };
  const input = { cadenceMs: MINUTE, lastRun: { ok: true }, lastOkAgeMs: 10_000, behind: null };
  assert.equal(jobVerdict({ ...input, metricCoverage: { supply: metric } }), "failing");
  assert.equal(jobVerdict({ ...input, metricCoverage: { supply: { ...metric, failed: 0 } } }), "filling");
  assert.equal(jobVerdict({ ...input, metricCoverage: { supply: { ...metric, failed: 0, current: 10, unread: 0 } } }), "fresh");
  assert.equal(jobVerdict({ ...input, lastOkAgeMs: 5 * MINUTE, metricCoverage: { supply: { ...metric, failed: 0 } } }), "late");
  assert.deepEqual(metricCoverageFromDetail({ metricCoverage: { supply: metric } }), { supply: metric });
  assert.equal(metricCoverageFromDetail({ metricCoverage: { supply: { ...metric, current: 11 } } }), null);
  assert.equal(metricCoverageFromDetail({ metricCoverage: { supply: { ...metric, measuredAt: "invalid" } } }), null);
  assert.equal(metricCoverageFromDetail({ metricCoverage: { supply: { ...metric, failed: -1 } } }), null);
});

test("jobVerdict: never before a run, failing after an error, fresh within two cadences, late after", function () {
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: null, lastOkAgeMs: null, behind: null }), "never");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: null }, lastOkAgeMs: null, behind: null }), "never");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: false }, lastOkAgeMs: 10_000, behind: null }), "failing");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: true }, lastOkAgeMs: 2 * MINUTE, behind: null }), "fresh");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: true }, lastOkAgeMs: 2 * MINUTE + 1, behind: null }), "late");
  // A ten-second job mid-run is not late until a minute has passed.
  assert.equal(jobVerdict({ cadenceMs: 10_000, lastRun: { ok: true }, lastOkAgeMs: 45_000, behind: null }), "fresh");
  assert.equal(jobVerdict({ cadenceMs: 10_000, lastRun: { ok: true }, lastOkAgeMs: LATE_FLOOR_MS + 1, behind: null }), "late");
});

test("jobVerdict: a checkpoint more than 10k blocks behind is filling, unless the run failed", function () {
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: null }, lastOkAgeMs: 5 * 60 * MINUTE, behind: BigInt(500_000) }), "filling");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: true }, lastOkAgeMs: 30_000, behind: BigInt(10_000) }), "fresh");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: false }, lastOkAgeMs: 30_000, behind: BigInt(500_000) }), "failing");
});

test("overallVerdict: a stopped daemon is stale, fewer than ten affected jobs remains live", function () {
  const fresh = [{ verdict: "fresh" as const }, { verdict: "filling" as const }];
  assert.equal(overallVerdict(10_000, fresh), "live");
  assert.equal(overallVerdict(DAEMON_STALE_MS + 1, fresh), "stale");
  assert.equal(overallVerdict(null, fresh), "stale");
  assert.equal(overallVerdict(10_000, [...fresh, { verdict: "failing" as const }]), "live");
  assert.equal(overallVerdict(10_000, [...fresh, { verdict: "late" as const }]), "live");
  assert.equal(overallVerdict(10_000, [{ verdict: "never" as const }]), "never");
  // The individual job remains never even while the aggregate is live.
  assert.equal(overallVerdict(10_000, [...fresh, { verdict: "never" as const }]), "live");
});

test("rateFromSamples: movement over the last hour, or nothing", function () {
  const now = new Date("2026-09-04T12:00:00Z");
  assert.equal(rateFromSamples([], BigInt(100), now), null);
  assert.equal(rateFromSamples([{ blockNumber: BigInt(100), at: new Date(now.getTime() - 30_000) }], BigInt(200), now), null);
  assert.equal(rateFromSamples([{ blockNumber: BigInt(1_000), at: new Date(now.getTime() - 30 * 60_000) }], BigInt(4_000), now), 6_000);
  assert.equal(rateFromSamples([{ blockNumber: BigInt(5_000), at: new Date(now.getTime() - 30 * 60_000) }], BigInt(4_000), now), null);
});

test("jobVerdict: a filling scanner whose checkpoint stopped moving is stalled", function () {
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: null }, lastOkAgeMs: 5 * MINUTE, behind: BigInt(500_000), checkpointAgeMs: 10 * MINUTE }), "filling");
  assert.equal(jobVerdict({ cadenceMs: MINUTE, lastRun: { ok: null }, lastOkAgeMs: 5 * MINUTE, behind: BigInt(500_000), checkpointAgeMs: STALL_FLOOR_MS + 1 }), "stalled");
  assert.equal(overallVerdict(10_000, [{ verdict: "fresh" as const }, { verdict: "stalled" as const }]), "live");
});


test("metadata backlog stays filling and never masks a late or failed worker", function () {
  const input = { cadenceMs: MINUTE, lastRun: { ok: true }, lastOkAgeMs: 30_000, behind: null, metadataBacklog: { due: 50, errors: 0 } };
  assert.equal(jobVerdict(input), "filling");
  assert.equal(jobVerdict({ ...input, metadataBacklog: { due: 0, errors: 2 } }), "filling");
  assert.equal(jobVerdict({ ...input, metadataBacklog: { due: 0, errors: 0 } }), "fresh");
  assert.equal(jobVerdict({ ...input, lastRun: { ok: false } }), "failing");
  assert.equal(jobVerdict({ ...input, lastOkAgeMs: 3 * MINUTE }), "late");
});


test("starting a retry does not erase the last completed failure", function () {
  const input = { cadenceMs: 6 * 60 * MINUTE, lastRun: { ok: null }, lastOkAgeMs: MINUTE, behind: null, lastFinishedOk: false };
  assert.equal(jobVerdict(input), "failing");
  assert.equal(jobVerdict({ ...input, lastRun: { ok: true } }), "fresh");
  assert.equal(jobVerdict({ ...input, lastFinishedOk: true }), "fresh");
});


test("ten unhealthy jobs degrade the aggregate while nine retain their individual results", function () {
  const states: JobVerdict[] = ["failing", "late", "stalled", "never"];
  const jobs: JobFreshness[] = JOB_NAMES.map(function reading(job, index) {
    return { job, cadenceMs: MINUTE, lastRunAt: null, lastOkAt: null, ageMs: null, rows: null, error: null, running: false, checkpoints: [], verdict: index < 9 ? states[index % states.length] : "fresh" };
  });
  const daemon = { name: "registry-daemon", lastBeatAt: new Date(), ageMs: 1000, alive: true, jobsReported: jobs.length, failing: [] };
  assert.equal(overallVerdict(1000, jobs), "live");
  const summary = summarize("live", daemon, jobs);
  assert.match(summary, /^9 of /);
  for (const label of ["failing:", "late:", "stalled:", "no completed run yet:"]) assert.ok(summary.includes(label));
  assert.ok(!summary.includes("Every job ran on time"));
  jobs[9].verdict = "failing";
  assert.equal(overallVerdict(1000, jobs), "degraded");
  assert.match(summarize("degraded", daemon, jobs), /^10 of /);
  assert.equal(overallVerdict(DAEMON_STALE_MS + 1, jobs), "stale");
  assert.equal(overallVerdict(null, jobs), "stale");
});
