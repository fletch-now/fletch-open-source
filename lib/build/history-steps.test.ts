import assert from "node:assert/strict";
import { test } from "node:test";
import { recordedBuildSteps } from "./history-steps";
import type { BuildEvent } from "./types";

test("reloaded history excludes panel-only events so the next replayed step is immediately visible", function () {
  const events: BuildEvent[] = Array.from({ length: 10 }, (_, index) => ({ phase: "scaffolding", text: `Read file ${index}`, toolCallId: `turn:${index}` }));
  for (let index = 0; index < 20; index++) {
    events.push({ phase: "scaffolding", text: `src/file-${index}.tsx`, artifact: { path: `src/file-${index}.tsx`, kind: "app", lines: 12 } });
  }
  events.push({ phase: "testing", text: "Analysis completed", analysis: { tool: "slither", version: "0.11.3", ran: true, skipped: null, findings: [], blocking: 0 } });
  const saved = recordedBuildSteps(events);
  assert.equal(saved.length, 10);
  assert.equal(saved.some((step) => step.input === "Analysis completed"), false);
  const next: BuildEvent = { phase: "hosting", text: "Publishing the frontend" };
  const replayed = recordedBuildSteps([...events, next]);
  assert.equal(replayed.length, 11);
  assert.ok(replayed.length >= saved.length, "the actual saved step count cannot suppress this new update");
  assert.equal(replayed.at(-1)?.input, next.text);
});

test("history preserves identified, empty and unidentified tool output around metadata events", function () {
  const output = "First line\n  Indented original output\nLast line";
  const events: BuildEvent[] = [
    { phase: "scaffolding", text: "Read first", toolCallId: "turn:first" },
    { phase: "scaffolding", text: "Read second", toolCallId: "turn:second" },
    { phase: "scaffolding", text: "src/app.tsx", artifact: { path: "src/app.tsx", kind: "app", lines: 3 } },
    { phase: "scaffolding", text: "empty result", toolCallId: "turn:second", toolOutput: "" },
    { phase: "scaffolding", text: "original output", toolCallId: "turn:first", toolOutput: output, toolOutputTruncated: true, toolOutputChars: 40_000 },
    { phase: "scaffolding", text: "legacy result", toolOutput: "Unidentified historical output" },
    { phase: "note", text: "The actual agent update." },
    { phase: "done", text: "Finished" },
  ];
  const saved = recordedBuildSteps(events);
  assert.equal(saved.length, 4);
  assert.equal(saved[0].output, output);
  assert.equal(saved[0].outputTruncated, true);
  assert.equal(saved[0].outputChars, 40_000);
  assert.equal(saved[1].output, "");
  assert.equal(saved[2].output, "Unidentified historical output");
  assert.equal(saved[3].input, "The actual agent update.");
});
