import assert from "node:assert/strict";
import { test } from "node:test";
import { JOB_CADENCES } from "./cadence";
import { failedRegistryJobDelay, registryStartupDelays, successfulRegistryJobDelay } from "./job-delay";

test("live swap ticks maintain their start cadence after the measured 33-second RPC workload", function () {
  const cadence = JOB_CADENCES["dex-swaps"];
  const duration = 33_000;
  const starts = [0];
  for (let i = 0; i < 3; i++) {
    const previous = starts.at(-1)!;
    starts.push(previous + duration + successfulRegistryJobDelay("dex-swaps", cadence, duration));
  }
  assert.deepEqual(starts, [0, 45_000, 90_000, 135_000]);
  for (let i = 1; i < starts.length; i++) {
    assert.ok(starts[i] + duration - starts[i - 1] < 120_000, "The prior observed head remains current until the next successful result");
  }
});

test("slow swap reads get breathing room and cannot immediately overlap the next run", function () {
  assert.equal(successfulRegistryJobDelay("dex-swaps", 60_000, 59_999), 5_000);
  assert.equal(successfulRegistryJobDelay("dex-swaps", 60_000, 90_000), 5_000);
});

test("history and other jobs retain their completion-based cadence", function () {
  for (const name of ["dex-swap-backfill", "canonical"] as const) {
    assert.equal(successfulRegistryJobDelay(name, JOB_CADENCES[name], 49_000), JOB_CADENCES[name]);
  }
});

test("failed swap reads retain a one-minute retry while slower jobs preserve exponential backoff", function () {
  for (const streak of [1, 2, 6, 10]) {
    assert.equal(failedRegistryJobDelay("dex-swaps", JOB_CADENCES["dex-swaps"], streak), 60_000);
    assert.equal(failedRegistryJobDelay("dex-swap-backfill", JOB_CADENCES["dex-swap-backfill"], streak), 60_000);
  }
  assert.deepEqual([1, 2, 3, 6, 10].map(function retry(streak) {
    return failedRegistryJobDelay("canonical", JOB_CADENCES.canonical, streak);
  }), [60_000, 120_000, 240_000, 1_920_000, 1_920_000]);
});

test("priority state and admission subtract work time without overlapping", function () {
  for (const name of ["dex-state", "priority-supply", "dex-token-discovery", "priority-universe"] as const) {
    assert.equal(successfulRegistryJobDelay(name, JOB_CADENCES[name], 20_000), JOB_CADENCES[name] - 20_000);
    assert.equal(successfulRegistryJobDelay(name, JOB_CADENCES[name], 90_000), 5_000);
  }
});


test("pool discovery starts each minute and slows safely when a scan exceeds its budget", function () {
  for (const name of ["dex-pools", "dex-pools-v3"] as const) {
    assert.equal(JOB_CADENCES[name], 60_000);
    assert.equal(successfulRegistryJobDelay(name, JOB_CADENCES[name], 17_000), 43_000);
    assert.equal(successfulRegistryJobDelay(name, JOB_CADENCES[name], 90_000), 5_000);
    assert.equal(failedRegistryJobDelay(name, JOB_CADENCES[name], 3), 60_000);
  }
});


test("restart starts every minute job within its first freshness window without a simultaneous burst", function startup() {
  const delays = registryStartupDelays(JOB_CADENCES);
  assert.equal(delays.size, Object.keys(JOB_CADENCES).length);
  assert.equal(delays.get("dex-swaps"), 0, "the expiring swap window starts immediately");
  assert.equal(new Set(delays.values()).size, delays.size, "job starts remain staggered");
  const minuteStarts = Object.entries(JOB_CADENCES).filter(([, cadence]) => cadence <= 60_000)
    .map(([name]) => delays.get(name)!);
  assert.ok(Math.max(...minuteStarts) < 60_000, "no minute job waits behind hourly scans");
  assert.ok(delays.get("app-catalog")! <= 5_000);
  assert.ok(delays.get("lookalikes")! < 60_000, "a restart cannot impose the previous 185-second lookalike delay");
  const starts = [...delays.entries()].sort((a, b) => a[1] - b[1]);
  for (let index = 1; index < starts.length; index++) {
    assert.ok(starts[index][1] - starts[index - 1][1] >= 1_500, "RPC jobs do not all start together");
  }
  const firstSlow = Math.min(...Object.entries(JOB_CADENCES).filter(([, cadence]) => cadence > 60_000)
    .map(([name]) => delays.get(name)!));
  assert.ok(firstSlow >= Math.max(...minuteStarts) + 5_000, "slow scans begin after prompt jobs with room between starts");
});

test("inserting slow jobs before the registry list cannot delay app catalog or lookalike recovery", function slowJobs() {
  const baseline = registryStartupDelays(JOB_CADENCES);
  const expanded = registryStartupDelays({ ...Object.fromEntries(Array.from({ length: 100 }, (_, index) =>
    [`slow-${index}`, 3_600_000])), ...JOB_CADENCES });
  for (const [name, cadence] of Object.entries(JOB_CADENCES)) {
    if (cadence <= 60_000) assert.equal(expanded.get(name), baseline.get(name), name);
  }
});
