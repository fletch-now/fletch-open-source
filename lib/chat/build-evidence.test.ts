import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BuildVerdict } from "../../components/chat/build-verdict";
import { progressSteps, type ProgressTrackProps } from "../../components/chat/progress-steps";
import { updateBuildEvidence, type BuildEvidence } from "./build-evidence";
import type { AnalysisReport, BuildEvent, CompileReport, TestReport } from "../build/types";

const compile: CompileReport = {
  ok: true, solc: "0.8.26", contracts: [], errors: [], warnings: 0, durationMs: 1,
};
const tests: TestReport = { total: 2, passed: 2, failed: 0, cases: [], durationMs: 1 };
const analysis: AnalysisReport = {
  tool: "slither", version: "0.11.0", ran: true, skipped: null, findings: [], blocking: 0,
};
const evidence: BuildEvidence = { compile, tests, analysis };
const idle: ProgressTrackProps = {
  stage: "done", running: false, result: null, noContract: false, hasThread: true,
};

function verdict(overrides: Partial<BuildEvidence> = {}, noContract = false): string {
  return renderToStaticMarkup(createElement(BuildVerdict, {
    ...evidence, ...overrides, running: false, noContract, result: null,
    onReport() {},
  }));
}

test("a second compilation invalidates tests and security from the prior source", function () {
  const events: BuildEvent[] = [
    { phase: "compiling", text: "first", compile },
    { phase: "testing", text: "passed", tests },
    { phase: "testing", text: "repair needed", analysis: { ...analysis, blocking: 1 } },
    { phase: "compiling", text: "repaired", compile: { ...compile, durationMs: 2 } },
    { phase: "error", text: "no tests" },
  ];
  const result = events.reduce(updateBuildEvidence, { compile: null, tests: null, analysis: null });
  assert.equal(result.compile?.durationMs, 2);
  assert.equal(result.tests, null);
  assert.equal(result.analysis, null);
});

test("failed recompilation clears prior passing evidence too", function () {
  const result = updateBuildEvidence(evidence, { phase: "compiling", compile: { ...compile, ok: false } });
  assert.equal(result.compile?.ok, false);
  assert.equal(result.tests, null);
  assert.equal(result.analysis, null);
});

test("reports provided with a new compilation supersede invalidated reports", function () {
  const currentTests = { ...tests, passed: 1, failed: 1 };
  const result = updateBuildEvidence(evidence, { phase: "compiling", compile, tests: currentTests, analysis });
  assert.equal(result.tests, currentTests);
  assert.equal(result.analysis, analysis);
});

test("terminal repeated compile and progress without a report preserve current evidence", function () {
  for (const phase of ["done", "error", "compiling"] as const) {
    const event = phase === "compiling" ? { phase } : { phase, compile };
    assert.deepEqual(updateBuildEvidence(evidence, event), evidence);
  }
});

test("missing executable tests never render 0/0 passed or completed Contract", function () {
  const missing = { ...tests, total: 0, passed: 0 };
  const html = verdict({ tests: missing });
  assert.match(html, /Compile: passed/);
  assert.match(html, /Tests: missing \(0 tests\)/);
  assert.doesNotMatch(html, /0\/0 passed/);
  assert.equal(progressSteps({ ...idle, ...evidence, tests: missing })[1].state, "blocked");
});

test("nonzero test exit and incomplete counts stay failed with original numbers", function () {
  for (const failed of [{ ...tests, exitCode: 2 }, { ...tests, passed: 1, failed: 0 }]) {
    const html = verdict({ tests: failed });
    assert.match(html, /Tests: failed/);
    assert.match(html, new RegExp(`${failed.passed}/${failed.total} passed`));
    assert.equal(progressSteps({ ...idle, ...evidence, tests: failed })[1].state, "blocked");
  }
});

test("an unavailable analyzer is incomplete and blocks Contract despite successful compilation", function () {
  const unavailable = { ...analysis, ran: false, skipped: "tool failed" };
  assert.match(verdict({ analysis: unavailable }), /Security: incomplete/);
  assert.equal(progressSteps({ ...idle, ...evidence, analysis: unavailable })[1].state, "blocked");
});

test("security findings and current failed checks override an older deploy receipt", function () {
  const result = { contractAddress: "0x123", explorerUrl: "https://explorer.test/0x123", previewUrl: "https://app.test" };
  const steps = progressSteps({ ...idle, ...evidence, result, analysis: { ...analysis, blocking: 2 } });
  assert.equal(steps[1].state, "blocked");
  assert.equal(steps[1].detail, "Security: 2 blocking");
  assert.equal(steps[2].href, result.previewUrl);
  assert.equal(steps[3].href, result.previewUrl);
});

test("unrecorded historical checks remain unknown rather than fabricated failures", function () {
  assert.match(verdict({ tests: null, analysis: null }), /Tests: not recorded/);
  assert.equal(progressSteps({ ...idle, compile })[1].state, "todo");
  const result = { contractAddress: "0x123", explorerUrl: "https://explorer.test/0x123" };
  assert.equal(progressSteps({ ...idle, result })[1].detail, "Deployment recorded");
});

test("frontend-only apps skip checks and measured passing checks complete Contract", function () {
  assert.match(verdict({ compile: null, tests: null, analysis: null }, true), /Contract checks skipped: frontend-only app/);
  assert.equal(progressSteps({ ...idle, noContract: true })[1].state, "skipped");
  assert.equal(progressSteps({ ...idle, ...evidence })[1].state, "done");
  assert.equal(progressSteps({ ...idle, ...evidence, running: true, stage: "testing", tests: { ...tests, total: 0 } })[1].state, "active");
});
